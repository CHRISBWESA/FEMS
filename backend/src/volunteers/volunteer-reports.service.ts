import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateRequiredUuid } from '../shared/utils/validation.util';
import { VolunteersAccessService } from './volunteers-access.service';
import { DAY_MS, hoursBetween, parseDateTime } from './volunteer.validation';

@Injectable()
export class VolunteerReportsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: VolunteersAccessService,
  ) {}

  private fellowshipSql(user: any, q?: string): Prisma.Sql {
    if (this.tenantScope.isAdmin(user)) return q ? Prisma.sql`AND o.fellowship_id = ${q}::uuid` : Prisma.empty;
    return user.fellowshipId ? Prisma.sql`AND o.fellowship_id = ${user.fellowshipId}::uuid` : Prisma.sql`AND FALSE`;
  }

  // Aggregates only - never names or per-person data. Fellowship-wide for managers and chairs; a department
  // leader sees only their own department's opportunities.
  async summary(user: any, q: { from?: string; to?: string; fellowshipId?: string } = {}) {
    this.access.requirePermission(user, PERMISSIONS.VOLUNTEER_REPORTS_VIEW);
    const deptScoped = this.access.isDepartmentLeader(user) && !this.access.hasPermission(user, PERMISSIONS.VOLUNTEER_MANAGE);
    if (deptScoped && !user.departmentId) throw new ForbiddenException('You are not assigned to a department.');
    if (q.fellowshipId && !isUuid(q.fellowshipId)) throw new BadRequestException('fellowshipId must be a valid id');

    const now = new Date();
    const to = q.to ? parseDateTime('to', q.to) : now;
    const from = q.from ? parseDateTime('from', q.from) : new Date(to.getTime() - 90 * DAY_MS);
    if (from > to) throw new BadRequestException('from cannot be after to');
    if (to.getTime() - from.getTime() > 5 * 366 * DAY_MS) throw new BadRequestException('The reporting range cannot exceed five years');

    const fel = this.fellowshipSql(user, q.fellowshipId);
    const dept = deptScoped ? Prisma.sql`AND o.department_id = ${user.departmentId}::uuid` : Prisma.empty;
    const win = Prisma.sql`s.starts_at >= ${from} AND s.starts_at <= ${to}`;
    const hoursExpr = Prisma.sql`EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 3600`;

    const [shiftsByStatus, assignmentsByStatus, served, capacity, byOpportunity, byDepartment, monthly, upcoming] = await Promise.all([
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT s.status::text AS status, COUNT(*)::int AS count
        FROM service_shifts s JOIN service_opportunities o ON o.id = s.opportunity_id
        WHERE ${win} ${fel} ${dept} GROUP BY s.status`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT a.status::text AS status, COUNT(*)::int AS count
        FROM service_assignments a JOIN service_shifts s ON s.id = a.shift_id JOIN service_opportunities o ON o.id = s.opportunity_id
        WHERE ${win} ${fel} ${dept} GROUP BY a.status`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT COALESCE(SUM(${hoursExpr}), 0)::float AS hours, COUNT(DISTINCT a.member_id)::int AS volunteers
        FROM service_assignments a JOIN service_shifts s ON s.id = a.shift_id JOIN service_opportunities o ON o.id = s.opportunity_id
        WHERE a.status = 'attended' AND ${win} ${fel} ${dept}`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT COALESCE(SUM(s.capacity), 0)::int AS capacity,
               COALESCE(SUM(LEAST(s.capacity, COALESCE(f.filled, 0))), 0)::int AS filled
        FROM service_shifts s JOIN service_opportunities o ON o.id = s.opportunity_id
        LEFT JOIN (SELECT shift_id, COUNT(*) AS filled FROM service_assignments WHERE status IN ('confirmed','attended') GROUP BY shift_id) f ON f.shift_id = s.id
        WHERE s.status = 'scheduled' AND ${win} ${fel} ${dept}`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT o.id, o.title, d.name AS department, COUNT(DISTINCT s.id)::int AS shifts,
               COUNT(a.id) FILTER (WHERE a.status IN ('confirmed','attended'))::int AS filled,
               COUNT(a.id) FILTER (WHERE a.status = 'attended')::int AS attended,
               COUNT(a.id) FILTER (WHERE a.status = 'no_show')::int AS no_show,
               COALESCE(SUM(${hoursExpr}) FILTER (WHERE a.status = 'attended'), 0)::float AS hours
        FROM service_opportunities o
        JOIN service_shifts s ON s.opportunity_id = o.id AND s.status = 'scheduled' AND ${win}
        LEFT JOIN service_assignments a ON a.shift_id = s.id
        LEFT JOIN departments d ON d.id = o.department_id
        WHERE TRUE ${fel} ${dept}
        GROUP BY o.id, o.title, d.name ORDER BY attended DESC, shifts DESC LIMIT 20`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT o.department_id AS "departmentId", d.name AS department, COUNT(DISTINCT s.id)::int AS shifts,
               COUNT(a.id) FILTER (WHERE a.status = 'attended')::int AS attended,
               COUNT(DISTINCT a.member_id) FILTER (WHERE a.status = 'attended')::int AS volunteers,
               COALESCE(SUM(${hoursExpr}) FILTER (WHERE a.status = 'attended'), 0)::float AS hours
        FROM service_opportunities o
        JOIN service_shifts s ON s.opportunity_id = o.id AND s.status = 'scheduled' AND ${win}
        LEFT JOIN service_assignments a ON a.shift_id = s.id
        LEFT JOIN departments d ON d.id = o.department_id
        WHERE TRUE ${fel} ${dept}
        GROUP BY o.department_id, d.name ORDER BY attended DESC`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', s.starts_at), 'YYYY-MM') AS month,
               COUNT(*) FILTER (WHERE a.status = 'attended')::int AS attended,
               COALESCE(SUM(${hoursExpr}) FILTER (WHERE a.status = 'attended'), 0)::float AS hours
        FROM service_assignments a JOIN service_shifts s ON s.id = a.shift_id JOIN service_opportunities o ON o.id = s.opportunity_id
        WHERE ${win} ${fel} ${dept} GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT COUNT(*)::int AS shifts, COUNT(*) FILTER (WHERE COALESCE(f.filled, 0) < s.capacity)::int AS unfilled
        FROM service_shifts s JOIN service_opportunities o ON o.id = s.opportunity_id
        LEFT JOIN (SELECT shift_id, COUNT(*) AS filled FROM service_assignments WHERE status IN ('confirmed','attended') GROUP BY shift_id) f ON f.shift_id = s.id
        WHERE s.status = 'scheduled' AND s.starts_at > ${now} AND s.starts_at <= ${new Date(now.getTime() + 14 * DAY_MS)} ${fel} ${dept}`),
    ]);

    const byStatus = Object.fromEntries(assignmentsByStatus.map((r) => [r.status, r.count]));
    const attended = byStatus.attended ?? 0;
    const noShow = byStatus.no_show ?? 0;
    const cap = capacity[0] ?? { capacity: 0, filled: 0 };
    return {
      window: { from, to },
      scope: deptScoped ? 'department' : 'fellowship',
      shifts: Object.fromEntries(shiftsByStatus.map((r) => [r.status, r.count])),
      assignments: byStatus,
      participation: {
        volunteers: served[0]?.volunteers ?? 0,
        hoursServed: Math.round((served[0]?.hours ?? 0) * 100) / 100,
        attendanceRate: attended + noShow > 0 ? Math.round((attended / (attended + noShow)) * 1000) / 10 : null,
        fillRate: cap.capacity > 0 ? Math.round((cap.filled / cap.capacity) * 1000) / 10 : null,
      },
      byOpportunity: byOpportunity.map((r) => ({ ...r, hours: Math.round(r.hours * 100) / 100 })),
      byDepartment: byDepartment.map((r) => ({ ...r, department: r.department ?? 'Fellowship-wide', hours: Math.round(r.hours * 100) / 100 })),
      monthly: monthly.map((r) => ({ ...r, hours: Math.round(r.hours * 100) / 100 })),
      upcoming: { next14Days: upcoming[0]?.shifts ?? 0, unfilled: upcoming[0]?.unfilled ?? 0 },
    };
  }

  // ---------- service history ----------

  private async historyFor(memberId: string) {
    const rows = await this.prisma.serviceAssignment.findMany({
      where: { member_id: memberId },
      orderBy: { shift: { starts_at: 'desc' } },
      take: 100,
      select: {
        id: true, status: true,
        shift: { select: { id: true, starts_at: true, ends_at: true, location: true, role: { select: { name: true } }, opportunity: { select: { id: true, title: true, department: { select: { name: true } } } } } },
      },
    });
    const items = rows.map((r) => ({
      id: r.id,
      status: r.status,
      startsAt: r.shift.starts_at,
      endsAt: r.shift.ends_at,
      location: r.shift.location,
      role: r.shift.role?.name ?? null,
      opportunity: { id: r.shift.opportunity.id, title: r.shift.opportunity.title },
      department: r.shift.opportunity.department?.name ?? null,
      hours: r.status === 'attended' ? hoursBetween(r.shift.starts_at, r.shift.ends_at) : 0,
    }));
    return {
      totals: {
        attended: items.filter((i) => i.status === 'attended').length,
        noShow: items.filter((i) => i.status === 'no_show').length,
        upcoming: items.filter((i) => i.status === 'confirmed' && i.startsAt > new Date()).length,
        hoursServed: Math.round(items.reduce((n, i) => n + i.hours, 0) * 100) / 100,
      },
      items,
    };
  }

  // Self-service: only the member record linked to the signed-in account.
  async mine(user: any) {
    const me = await this.access.requireMyMember(user);
    return this.historyFor(me.id);
  }

  // Managers with volunteer.history_view may read any member's service history in their fellowship (audited).
  async memberHistory(memberId: string, user: any) {
    this.access.requirePermission(user, PERMISSIONS.VOLUNTEER_HISTORY_VIEW);
    const id = validateRequiredUuid('memberId', memberId);
    const member = await this.prisma.member.findUnique({ where: { id }, select: { id: true, full_name: true, fellowship_id: true } });
    if (!member) throw new NotFoundException('Member not found');
    this.tenantScope.assertInScope(user, member);
    await this.auditService.log({ userId: user.userId, action: 'volunteer.history_view', entityType: 'member', entityId: id });
    return { member: { id: member.id, fullName: member.full_name }, ...(await this.historyFor(id)) };
  }

  // ---------- reminders ----------

  // There is no scheduler in this codebase, so a manager (or a cron job calling this endpoint) triggers it.
  // Each confirmed volunteer is reminded once per shift, 24 hours ahead, with neutral text.
  async runReminders(user: any) {
    this.access.requirePermission(user, PERMISSIONS.VOLUNTEER_MANAGE);
    const now = new Date();
    const rows = await this.prisma.serviceAssignment.findMany({
      where: this.tenantScope.scopeWhere(user, { status: 'confirmed', shift: { status: 'scheduled', starts_at: { gt: now, lte: new Date(now.getTime() + DAY_MS) } } }),
      select: { shift_id: true, fellowship_id: true, member: { select: { user_id: true } } },
      take: 2000,
    });
    let sent = 0;
    for (const r of rows) {
      if (!r.member.user_id) continue;
      const already = await this.prisma.notification.findFirst({ where: { recipient_user_id: r.member.user_id, event_type: 'volunteer_reminder', entity_id: r.shift_id }, select: { id: true } });
      if (already) continue;
      await this.access.notify(r.member.user_id, 'volunteer_reminder', 'Upcoming service', 'You are scheduled to serve within the next 24 hours.', r.shift_id, r.fellowship_id);
      sent++;
    }
    await this.auditService.log({ userId: user.userId, action: 'volunteer.reminders_run', entityType: 'service_shift', entityId: user.userId, newValue: { candidates: rows.length, sent } });
    return { candidates: rows.length, sent };
  }
}
