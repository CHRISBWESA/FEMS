import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateDate } from '../shared/utils/validation.util';
import { ResourcesAccessService } from './resources-access.service';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class ResourcesReportsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
    private access: ResourcesAccessService,
  ) {}

  private async names(model: 'assetCategory' | 'assetLocation' | 'department', ids: (string | null)[]) {
    const real = Array.from(new Set(ids.filter((i): i is string => !!i)));
    if (!real.length) return new Map<string, string>();
    const rows = await (this.prisma as any)[model].findMany({ where: { id: { in: real } }, select: { id: true, name: true } });
    return new Map<string, string>(rows.map((r: any) => [r.id, r.name]));
  }

  private fellowshipSql(user: any, q?: string): Prisma.Sql {
    if (this.tenantScope.isAdmin(user)) return q ? Prisma.sql`AND a.fellowship_id = ${q}::uuid` : Prisma.empty;
    return user.fellowshipId ? Prisma.sql`AND a.fellowship_id = ${user.fellowshipId}::uuid` : Prisma.sql`AND FALSE`;
  }

  async summary(user: any, q: { from?: string; to?: string; fellowshipId?: string } = {}) {
    const mode = this.access.requireViewer(user);
    if (mode === 'fellowship') this.access.requirePermission(user, PERMISSIONS.RESOURCES_REPORTS_VIEW);
    if (q.fellowshipId && !isUuid(q.fellowshipId)) throw new BadRequestException('fellowshipId must be a valid id');
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 1 }) ?? new Date();
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 1 }) ?? new Date(to.getTime() - 90 * DAY);
    if (from > to) throw new BadRequestException('from cannot be after to');
    if (to.getTime() - from.getTime() > 5 * 366 * DAY) throw new BadRequestException('The reporting range cannot exceed five years');

    const assetWhere = this.access.assetScope(user, {}, q.fellowshipId) as any;
    const now = new Date();
    const cost = this.access.canSeeCost(user);
    const deptFilter = mode === 'department' ? Prisma.sql`AND a.owning_department_id = ${user.departmentId}::uuid` : Prisma.empty;

    const [byStatus, byCategory, byLocation, byCondition, byDepartment, valueAgg, openLoans, overdueLoans, maintByStatus, overdueMaint, moved, lowStock] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['status'], where: assetWhere, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['category_id'], where: { ...assetWhere, status: { notIn: ['retired', 'lost'] } }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['location_id'], where: { ...assetWhere, status: { notIn: ['retired', 'lost'] } }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['condition'], where: { ...assetWhere, status: { notIn: ['retired', 'lost'] } }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['owning_department_id'], where: { ...assetWhere, status: { notIn: ['retired', 'lost'] } }, _count: { _all: true } }),
      cost ? this.prisma.asset.aggregate({ where: { ...assetWhere, status: { notIn: ['retired', 'lost'] } }, _sum: { acquisition_cost: true } }) : Promise.resolve(null),
      this.prisma.assetLoan.count({ where: { checked_in_at: null, asset: assetWhere } }),
      this.prisma.assetLoan.count({ where: { checked_in_at: null, due_date: { lt: now }, asset: assetWhere } }),
      this.prisma.assetMaintenance.groupBy({ by: ['status'], where: { asset: assetWhere, status: { in: ['scheduled', 'in_progress'] } }, _count: { _all: true } }),
      this.prisma.assetMaintenance.count({ where: { asset: assetWhere, status: { in: ['scheduled', 'in_progress'] }, scheduled_for: { lt: now } } }),
      this.prisma.assetHistory.groupBy({ by: ['event_type'], where: { occurred_at: { gte: from, lte: to }, asset: assetWhere, event_type: { in: ['transferred', 'checked_out', 'checked_in', 'maintenance_completed', 'retired', 'lost'] } }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ id: string; asset_tag: string; name: string; quantity: number; reorder_level: number }[]>(Prisma.sql`
        SELECT a.id, a.asset_tag, a.name, a.quantity, a.reorder_level FROM assets a
        WHERE a.is_consumable = TRUE AND a.reorder_level IS NOT NULL AND a.quantity <= a.reorder_level
          AND a.status NOT IN ('retired', 'lost') ${this.fellowshipSql(user, q.fellowshipId)} ${deptFilter}
        ORDER BY a.name LIMIT 100`),
    ]);

    const [catNames, locNames, deptNames] = await Promise.all([
      this.names('assetCategory', byCategory.map((r) => r.category_id)),
      this.names('assetLocation', byLocation.map((r) => r.location_id)),
      this.names('department', byDepartment.map((r) => r.owning_department_id)),
    ]);

    return {
      scope: mode,
      generatedAt: now,
      range: { from, to },
      totals: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      byCategory: byCategory.map((r) => ({ categoryId: r.category_id, name: r.category_id ? catNames.get(r.category_id) ?? null : 'Uncategorised', count: r._count._all })),
      byLocation: byLocation.map((r) => ({ locationId: r.location_id, name: r.location_id ? locNames.get(r.location_id) ?? null : 'No location', count: r._count._all })),
      byCondition: byCondition.map((r) => ({ condition: r.condition, count: r._count._all })),
      byDepartment: byDepartment.map((r) => ({ departmentId: r.owning_department_id, name: r.owning_department_id ? deptNames.get(r.owning_department_id) ?? null : 'Fellowship-wide', count: r._count._all })),
      acquisitionValue: cost ? new Prisma.Decimal(valueAgg?._sum.acquisition_cost ?? 0).toString() : null,
      loans: { open: openLoans, overdue: overdueLoans },
      maintenance: { open: Object.fromEntries(maintByStatus.map((r) => [r.status, r._count._all])), overdue: overdueMaint },
      movement: Object.fromEntries(moved.map((r) => [r.event_type, r._count._all])),
      lowStock,
    };
  }

  // Sends neutral reminders for overdue loans (to the borrower's own account) and overdue maintenance
  // (to the Secretary/Assistant Secretary). Idempotent per day: an entity is reminded at most once every 24h.
  // There is no scheduler in this codebase, so this is triggered by an authorised person (or an external cron).
  async runReminders(user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY);
    const assetWhere = this.tenantScope.scopeWhere(user, {}) as any;

    const overdueLoans = await this.prisma.assetLoan.findMany({
      where: { checked_in_at: null, due_date: { lt: now }, asset: assetWhere },
      select: { id: true, fellowship_id: true, asset_id: true, member: { select: { user_id: true } } },
      take: 500,
    });
    let loanReminders = 0;
    for (const loan of overdueLoans) {
      if (!loan.member.user_id) continue;
      const recent = await this.prisma.notification.findFirst({ where: { recipient_user_id: loan.member.user_id, event_type: 'resource_overdue', entity_id: loan.asset_id, created_at: { gte: dayAgo } }, select: { id: true } });
      if (recent) continue;
      await this.notificationEngine.create({ recipientUserId: loan.member.user_id, eventType: 'resource_overdue', title: 'Item overdue', message: 'An item you borrowed is overdue for return.', entityType: 'asset', entityId: loan.asset_id, fellowshipId: loan.fellowship_id });
      loanReminders++;
    }

    const overdueMaint = await this.prisma.assetMaintenance.findMany({
      where: { status: { in: ['scheduled', 'in_progress'] }, scheduled_for: { lt: now }, asset: assetWhere },
      select: { id: true, asset_id: true, fellowship_id: true },
      take: 500,
    });
    let maintenanceReminders = 0;
    if (overdueMaint.length > 0) {
      const recipients = await this.prisma.user.findMany({
        where: { roles: { hasSome: ['secretary', 'assistant_secretary'] }, fellowship_id: this.tenantScope.isAdmin(user) ? undefined : user.fellowshipId, is_active: true, deleted_at: null },
        select: { id: true, fellowship_id: true },
        take: 20,
      });
      for (const r of recipients) {
        const mine = overdueMaint.filter((m) => m.fellowship_id === r.fellowship_id);
        if (mine.length === 0) continue;
        const recent = await this.prisma.notification.findFirst({ where: { recipient_user_id: r.id, event_type: 'resource_maintenance_overdue', created_at: { gte: dayAgo } }, select: { id: true } });
        if (recent) continue;
        await this.notificationEngine.create({ recipientUserId: r.id, eventType: 'resource_maintenance_overdue', title: 'Maintenance overdue', message: 'Maintenance is overdue for one or more assets.', entityType: 'asset', fellowshipId: r.fellowship_id });
        maintenanceReminders++;
      }
    }

    await this.auditService.log({ userId: user.userId, action: 'resources.reminders_run', entityType: 'asset', newValue: { loanReminders, maintenanceReminders } });
    return { overdueLoans: overdueLoans.length, loanReminders, overdueMaintenance: overdueMaint.length, maintenanceReminders };
  }
}
