import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAmount, validateDate, validateText } from '../shared/utils/validation.util';
import { ResourcesAccessService } from './resources-access.service';
import { CONDITIONS } from './assets.service';

const TYPES = ['scheduled', 'repair', 'inspection'];

@Injectable()
export class AssetMaintenanceService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private access: ResourcesAccessService,
  ) {}

  private present(m: any, user: any) {
    if (this.access.canSeeCost(user)) return m;
    const { cost, ...rest } = m;
    return rest;
  }

  private async loadMaintenance(mid: string, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MAINTENANCE_MANAGE);
    if (!isUuid(mid)) throw new NotFoundException('Maintenance record not found');
    const m = await this.prisma.assetMaintenance.findUnique({ where: { id: mid } });
    if (!m) throw new NotFoundException('Maintenance record not found');
    // Reuses the asset access rules (tenant + department scope) for the parent asset.
    const asset = await this.access.loadAsset(m.asset_id, user);
    return { m, asset };
  }

  async listForAsset(id: string, user: any) {
    await this.access.loadAsset(id, user);
    const rows = await this.prisma.assetMaintenance.findMany({ where: { asset_id: id }, orderBy: { scheduled_for: 'desc' }, take: 200 });
    return rows.map((r) => this.present(r, user));
  }

  // Fellowship-wide (or department-scoped) work list. `overdue=true` = scheduled/in progress and past due.
  async list(user: any, q: Record<string, string | undefined> = {}) {
    this.access.requireViewer(user);
    const { take, skip } = this.access.parsePaging(q.limit, q.page, 100);
    const assetWhere = this.access.assetScope(user, {}, q.fellowshipId);
    const where: Prisma.AssetMaintenanceWhereInput = { asset: assetWhere as any };
    if (q.status) {
      if (!['scheduled', 'in_progress', 'completed', 'cancelled'].includes(q.status)) throw new BadRequestException('Invalid status');
      where.status = q.status as any;
    }
    if (q.overdue === 'true') {
      where.status = { in: ['scheduled', 'in_progress'] };
      where.scheduled_for = { lt: new Date() };
    }
    const rows = await this.prisma.assetMaintenance.findMany({
      where, orderBy: { scheduled_for: 'asc' }, take, skip,
      include: { asset: { select: { id: true, asset_tag: true, name: true } } },
    });
    return rows.map((r) => this.present(r, user));
  }

  async schedule(id: string, dto: any, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MAINTENANCE_MANAGE);
    const asset = await this.access.loadAsset(id, user);
    if (['retired', 'lost'].includes(asset.status)) throw new ConflictException('A retired or lost asset cannot be scheduled for maintenance.');
    if (!TYPES.includes(dto?.type)) throw new BadRequestException(`type must be one of: ${TYPES.join(', ')}`);
    const scheduledFor = validateDate('scheduledFor', dto?.scheduledFor, { maxFutureDays: 1825 }) as Date;
    const description = validateText('description', dto?.description, 1000, true) as string;
    const performedBy = validateText('performedBy', dto?.performedBy, 200);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetMaintenance.create({
        data: { fellowship_id: asset.fellowship_id, asset_id: id, type: dto.type, scheduled_for: scheduledFor, description, performed_by: performedBy, created_by: user.userId },
      });
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'maintenance_scheduled', actorId: user.userId, note: description.slice(0, 200) }) });
      return created;
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.maintenance_schedule', entityType: 'asset', entityId: id, newValue: { maintenanceId: row.id, type: dto.type } });
    return this.present(row, user);
  }

  async start(mid: string, user: any) {
    const { m, asset } = await this.loadMaintenance(mid, user);
    const row = await this.prisma.$transaction(async (tx) => {
      const step = await tx.assetMaintenance.updateMany({ where: { id: mid, status: 'scheduled' }, data: { status: 'in_progress', started_at: new Date() } });
      if (step.count !== 1) throw new ConflictException('This maintenance is not in the scheduled state.');
      // The asset must be free to take out of service (not on loan, not retired).
      const flip = await tx.asset.updateMany({ where: { id: m.asset_id, status: 'available' }, data: { status: 'in_maintenance' } });
      if (flip.count !== 1) throw new ConflictException('The asset must be available (not on loan or already in maintenance) to start maintenance.');
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: m.asset_id, eventType: 'maintenance_started', actorId: user.userId, fromValue: 'available', toValue: 'in_maintenance' }) });
      return tx.assetMaintenance.findUniqueOrThrow({ where: { id: mid } });
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.maintenance_start', entityType: 'asset', entityId: m.asset_id, newValue: { maintenanceId: mid } });
    return this.present(row, user);
  }

  async complete(mid: string, dto: any, user: any) {
    const { m, asset } = await this.loadMaintenance(mid, user);
    let cost: string | null = null;
    if (dto?.cost !== undefined && dto.cost !== null) {
      this.access.requirePermission(user, PERMISSIONS.RESOURCES_COST_VIEW); // cost is financial data
      cost = validateAmount('cost', dto.cost, { allowZero: true });
    }
    const conditionAfter = dto?.conditionAfter === undefined ? null : dto.conditionAfter;
    if (conditionAfter !== null && !CONDITIONS.includes(conditionAfter)) throw new BadRequestException(`conditionAfter must be one of: ${CONDITIONS.join(', ')}`);
    const notes = validateText('notes', dto?.notes, 500);
    const performedBy = validateText('performedBy', dto?.performedBy, 200);

    const row = await this.prisma.$transaction(async (tx) => {
      const step = await tx.assetMaintenance.updateMany({
        where: { id: mid, status: 'in_progress' },
        data: { status: 'completed', completed_at: new Date(), cost, condition_after: conditionAfter, notes, ...(performedBy ? { performed_by: performedBy } : {}) },
      });
      if (step.count !== 1) throw new ConflictException('This maintenance is not in progress.');
      const back = await tx.asset.updateMany({ where: { id: m.asset_id, status: 'in_maintenance' }, data: { status: 'available', ...(conditionAfter ? { condition: conditionAfter } : {}) } });
      if (back.count !== 1) throw new ConflictException('The asset is no longer in maintenance (it may have been retired).');
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: m.asset_id, eventType: 'maintenance_completed', actorId: user.userId, fromValue: 'in_maintenance', toValue: 'available', note: notes }) });
      if (conditionAfter && conditionAfter !== asset.condition) {
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: m.asset_id, eventType: 'condition_changed', actorId: user.userId, fromValue: asset.condition, toValue: conditionAfter }) });
      }
      return tx.assetMaintenance.findUniqueOrThrow({ where: { id: mid } });
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.maintenance_complete', entityType: 'asset', entityId: m.asset_id, newValue: { maintenanceId: mid } });
    return this.present(row, user);
  }

  async cancel(mid: string, user: any) {
    const { m, asset } = await this.loadMaintenance(mid, user);
    const row = await this.prisma.$transaction(async (tx) => {
      // Each state is cancelled by its own conditional write, so "was it in progress?" is decided by the
      // write itself (not by a stale read) and the asset is only returned to service when it really was.
      const wasInProgress = await tx.assetMaintenance.updateMany({ where: { id: mid, status: 'in_progress' }, data: { status: 'cancelled' } });
      if (wasInProgress.count === 1) {
        await tx.asset.updateMany({ where: { id: m.asset_id, status: 'in_maintenance' }, data: { status: 'available' } });
      } else {
        const wasScheduled = await tx.assetMaintenance.updateMany({ where: { id: mid, status: 'scheduled' }, data: { status: 'cancelled' } });
        if (wasScheduled.count !== 1) throw new ConflictException('This maintenance can no longer be cancelled.');
      }
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: m.asset_id, eventType: 'maintenance_cancelled', actorId: user.userId }) });
      return tx.assetMaintenance.findUniqueOrThrow({ where: { id: mid } });
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.maintenance_cancel', entityType: 'asset', entityId: m.asset_id, newValue: { maintenanceId: mid } });
    return this.present(row, user);
  }
}
