import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import {
  validateAmount,
  validateDate,
  validateOptionalUuid,
  validateRequiredUuid,
  validateText,
} from '../shared/utils/validation.util';
import { ResourcesAccessService } from './resources-access.service';

export const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;
const OUTCOMES = ['retired', 'lost'] as const;
const MAX_QTY = 1_000_000;

export interface CreateAssetDto {
  name?: string; description?: string; categoryId?: string; locationId?: string; serialNumber?: string;
  acquisitionDate?: string; acquisitionCost?: number; acquisitionExpenseId?: string; condition?: string;
  isConsumable?: boolean; quantity?: number; reorderLevel?: number | null;
  owningDepartmentId?: string; custodianMemberId?: string; notes?: string; fellowshipId?: string;
}

function intInRange(field: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new BadRequestException(`${field} must be a whole number between ${min} and ${max}`);
  }
  return v;
}

function condition(field: string, v: unknown): (typeof CONDITIONS)[number] {
  if (!CONDITIONS.includes(v as any)) throw new BadRequestException(`${field} must be one of: ${CONDITIONS.join(', ')}`);
  return v as any;
}

const INCLUDE = {
  category: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  owning_department: { select: { id: true, name: true } },
  custodian: { select: { id: true, full_name: true } },
} as const;

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private access: ResourcesAccessService,
  ) {}

  // Acquisition cost/expense reference are financial: hidden unless the caller holds resources.cost_view.
  present(asset: any, user: any): any {
    if (this.access.canSeeCost(user)) return asset;
    const { acquisition_cost, acquisition_expense_id, ...rest } = asset;
    return rest;
  }

  async list(user: any, q: Record<string, string | undefined> = {}): Promise<{ data: any[]; total: number }> {
    const mode = this.access.requireViewer(user);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = {};
    if (q.status) extra.status = validateText('status', q.status, 30);
    if (q.condition) extra.condition = condition('condition', q.condition);
    if (q.categoryId) extra.category_id = validateRequiredUuid('categoryId', q.categoryId);
    if (q.locationId) extra.location_id = validateRequiredUuid('locationId', q.locationId);
    if (q.custodianId) extra.custodian_member_id = validateRequiredUuid('custodianId', q.custodianId);
    if (q.consumable === 'true') extra.is_consumable = true;
    if (q.consumable === 'false') extra.is_consumable = false;
    // A department leader is pinned to their own department by assetScope(); the filter cannot widen it.
    if (q.departmentId && mode === 'fellowship') extra.owning_department_id = validateRequiredUuid('departmentId', q.departmentId);
    const text = validateText('q', q.q, 100);
    if (text) {
      extra.OR = [
        { name: { contains: text, mode: 'insensitive' } },
        { asset_tag: { contains: text, mode: 'insensitive' } },
        { serial_number: { contains: text, mode: 'insensitive' } },
      ];
    }
    const where = this.access.assetScope(user, extra, q.fellowshipId) as Prisma.AssetWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({ where, include: INCLUDE, orderBy: [{ name: 'asc' }, { asset_tag: 'asc' }], take, skip }),
      this.prisma.asset.count({ where }),
    ]);
    return { data: rows.map((a) => this.present(a, user)), total };
  }

  async get(id: string, user: any): Promise<any> {
    await this.access.loadAsset(id, user);
    const asset = await this.prisma.asset.findUnique({ where: { id }, include: INCLUDE });
    const openLoan = await this.prisma.assetLoan.findFirst({
      where: { asset_id: id, checked_in_at: null },
      select: { id: true, checked_out_at: true, due_date: true, member: { select: { id: true, full_name: true } } },
    });
    return { ...this.present(asset, user), openLoan };
  }

  async create(dto: CreateAssetDto, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const name = validateText('name', dto?.name, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const serial = validateText('serialNumber', dto?.serialNumber, 100);
    const notes = validateText('notes', dto?.notes, 1000);
    const cond = dto?.condition === undefined ? 'good' : condition('condition', dto.condition);
    const isConsumable = dto?.isConsumable === true;
    const quantity = dto?.quantity === undefined ? 1 : intInRange('quantity', dto.quantity, 1, MAX_QTY);
    const reorder = dto?.reorderLevel === undefined || dto.reorderLevel === null ? null : intInRange('reorderLevel', dto.reorderLevel, 0, MAX_QTY);
    if (reorder !== null && !isConsumable) throw new BadRequestException('reorderLevel applies to consumable stock only');

    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const locationId = validateOptionalUuid('locationId', dto?.locationId);
    const departmentId = validateOptionalUuid('owningDepartmentId', dto?.owningDepartmentId);
    const custodianId = validateOptionalUuid('custodianMemberId', dto?.custodianMemberId);
    const expenseId = validateOptionalUuid('acquisitionExpenseId', dto?.acquisitionExpenseId);
    const acquisitionDate = validateDate('acquisitionDate', dto?.acquisitionDate, { required: false, maxFutureDays: 1 }) ?? null;
    let cost: string | null = null;
    if (dto?.acquisitionCost !== undefined && dto.acquisitionCost !== null) {
      this.access.requirePermission(user, PERMISSIONS.RESOURCES_COST_VIEW); // cost is financial data
      cost = validateAmount('acquisitionCost', dto.acquisitionCost, { allowZero: true });
    }
    if (expenseId) this.access.requirePermission(user, PERMISSIONS.RESOURCES_COST_VIEW);

    if (categoryId) await this.access.assertCategory(categoryId, fellowshipId);
    if (locationId) await this.access.assertLocation(locationId, fellowshipId);
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    if (custodianId) await this.access.assertMember(custodianId, fellowshipId);
    if (expenseId) await this.access.assertExpense(expenseId, fellowshipId);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const asset = await this.prisma.$transaction(async (tx) => {
          const created = await tx.asset.create({
            data: {
              fellowship_id: fellowshipId, asset_tag: this.access.generateTag(), name, description,
              category_id: categoryId, location_id: locationId, serial_number: serial,
              acquisition_date: acquisitionDate, acquisition_cost: cost, acquisition_expense_id: expenseId,
              condition: cond, is_consumable: isConsumable, quantity, reorder_level: reorder,
              owning_department_id: departmentId, custodian_member_id: custodianId, notes, created_by: user.userId,
            },
          });
          await tx.assetHistory.create({
            data: this.access.historyData({
              fellowshipId, assetId: created.id, eventType: 'created', actorId: user.userId,
              toDepartmentId: departmentId, toLocationId: locationId, memberId: custodianId, toValue: cond,
            }),
          });
          return created;
        });
        await this.auditService.log({ userId: user.userId, action: 'resources.asset_create', entityType: 'asset', entityId: asset.id, newValue: { tag: asset.asset_tag, name } });
        return this.present(asset, user);
      } catch (err: any) {
        if (err?.code === 'P2002') continue; // tag collision: draw another
        throw err;
      }
    }
    throw new ConflictException('Could not allocate a unique asset tag. Please try again.');
  }

  async update(id: string, dto: Partial<CreateAssetDto>, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    const asset = await this.access.loadAsset(id, user);
    if (['retired', 'lost'].includes(asset.status)) throw new ConflictException('A retired or lost asset can no longer be edited.');

    const data: Record<string, any> = {};
    const hist: any[] = [];
    if (dto.name !== undefined) data.name = validateText('name', dto.name, 200, true);
    if (dto.description !== undefined) data.description = validateText('description', dto.description, 1000);
    if (dto.serialNumber !== undefined) data.serial_number = validateText('serialNumber', dto.serialNumber, 100);
    if (dto.notes !== undefined) data.notes = validateText('notes', dto.notes, 1000);
    if (dto.categoryId !== undefined) {
      data.category_id = validateOptionalUuid('categoryId', dto.categoryId);
      if (data.category_id) await this.access.assertCategory(data.category_id, asset.fellowship_id);
    }
    if (dto.reorderLevel !== undefined) {
      if (!asset.is_consumable) throw new BadRequestException('reorderLevel applies to consumable stock only');
      data.reorder_level = dto.reorderLevel === null ? null : intInRange('reorderLevel', dto.reorderLevel, 0, MAX_QTY);
    }
    if (dto.acquisitionDate !== undefined) data.acquisition_date = validateDate('acquisitionDate', dto.acquisitionDate, { required: false, maxFutureDays: 1 }) ?? null;
    if (dto.acquisitionCost !== undefined) {
      this.access.requirePermission(user, PERMISSIONS.RESOURCES_COST_VIEW);
      data.acquisition_cost = dto.acquisitionCost === null ? null : validateAmount('acquisitionCost', dto.acquisitionCost, { allowZero: true });
    }
    if (dto.acquisitionExpenseId !== undefined) {
      this.access.requirePermission(user, PERMISSIONS.RESOURCES_COST_VIEW);
      data.acquisition_expense_id = validateOptionalUuid('acquisitionExpenseId', dto.acquisitionExpenseId);
      if (data.acquisition_expense_id) await this.access.assertExpense(data.acquisition_expense_id, asset.fellowship_id);
    }
    if (dto.condition !== undefined) {
      const c = condition('condition', dto.condition);
      if (c !== asset.condition) {
        data.condition = c;
        hist.push({ eventType: 'condition_changed', fromValue: asset.condition, toValue: c });
      }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.asset.update({ where: { id }, data });
      const nonConditionChange = Object.keys(data).some((k) => k !== 'condition');
      if (nonConditionChange) {
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'updated', actorId: user.userId, note: `Fields changed: ${Object.keys(data).filter((k) => k !== 'condition').join(', ')}` }) });
      }
      for (const h of hist) {
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, actorId: user.userId, ...h }) });
      }
      return row;
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_edit', entityType: 'asset', entityId: id, newValue: { fields: Object.keys(data) } });
    return this.present(updated, user);
  }

  // Moves ownership (department), responsibility (custodian) and/or location. `null` clears a value,
  // an omitted key leaves it unchanged. Not allowed while the asset is on loan or after retirement.
  async transfer(id: string, dto: any, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_ASSIGN);
    const asset = await this.access.loadAsset(id, user);
    if (['retired', 'lost'].includes(asset.status)) throw new ConflictException('A retired or lost asset cannot be transferred.');
    if (asset.status === 'checked_out') throw new ConflictException('Check the asset in before transferring it.');

    const has = (k: string) => dto && Object.prototype.hasOwnProperty.call(dto, k);
    const data: Record<string, any> = {};
    let custodian: any = null;
    if (has('toDepartmentId')) {
      data.owning_department_id = validateOptionalUuid('toDepartmentId', dto.toDepartmentId);
      if (data.owning_department_id) await this.access.assertDepartment(data.owning_department_id, asset.fellowship_id);
    }
    if (has('toLocationId')) {
      data.location_id = validateOptionalUuid('toLocationId', dto.toLocationId);
      if (data.location_id) await this.access.assertLocation(data.location_id, asset.fellowship_id);
    }
    if (has('toCustodianMemberId')) {
      data.custodian_member_id = validateOptionalUuid('toCustodianMemberId', dto.toCustodianMemberId);
      if (data.custodian_member_id) custodian = await this.access.assertMember(data.custodian_member_id, asset.fellowship_id);
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Provide toDepartmentId, toLocationId and/or toCustodianMemberId');
    const reason = validateText('reason', dto?.reason, 500);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional write: the asset must still be in the state we validated against.
      const res = await tx.asset.updateMany({ where: { id, status: { in: ['available', 'in_maintenance'] } }, data });
      if (res.count !== 1) throw new ConflictException('The asset changed while transferring it. Refresh and try again.');
      await tx.assetHistory.create({
        data: this.access.historyData({
          fellowshipId: asset.fellowship_id, assetId: id, eventType: 'transferred', actorId: user.userId,
          memberId: data.custodian_member_id ?? null,
          fromDepartmentId: asset.owning_department_id, toDepartmentId: has('toDepartmentId') ? data.owning_department_id : asset.owning_department_id,
          fromLocationId: asset.location_id, toLocationId: has('toLocationId') ? data.location_id : asset.location_id,
          note: reason,
        }),
      });
      return tx.asset.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_transfer', entityType: 'asset', entityId: id, comment: reason ?? undefined });
    if (custodian) await this.access.notifyMember(custodian, 'Asset assigned', 'An asset has been assigned to you.', id, asset.fellowship_id);
    return this.present(updated, user);
  }

  async retire(id: string, dto: any, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_RETIRE);
    const asset = await this.access.loadAsset(id, user);
    const outcome = dto?.outcome === undefined ? 'retired' : dto.outcome;
    if (!OUTCOMES.includes(outcome)) throw new BadRequestException(`outcome must be one of: ${OUTCOMES.join(', ')}`);
    const reason = validateText('reason', dto?.reason, 500, true) as string;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.asset.updateMany({
        where: { id, status: { in: ['available', 'in_maintenance'] } },
        data: { status: outcome, retired_at: new Date(), retired_reason: reason },
      });
      if (res.count !== 1) {
        throw new ConflictException(asset.status === 'checked_out' ? 'Check the asset in before retiring it.' : 'This asset is already retired or lost.');
      }
      await tx.assetMaintenance.updateMany({ where: { asset_id: id, status: { in: ['scheduled', 'in_progress'] } }, data: { status: 'cancelled' } });
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: outcome === 'lost' ? 'lost' : 'retired', actorId: user.userId, fromValue: asset.status, toValue: outcome, note: reason }) });
      return tx.asset.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    await this.auditService.log({ userId: user.userId, action: `resources.asset_${outcome}`, entityType: 'asset', entityId: id, comment: reason });
    return this.present(updated, user);
  }

  async adjustQuantity(id: string, dto: any, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    const asset = await this.access.loadAsset(id, user);
    if (!asset.is_consumable) throw new BadRequestException('Only consumable stock has an adjustable quantity.');
    if (['retired', 'lost'].includes(asset.status)) throw new ConflictException('A retired asset cannot be adjusted.');
    if (typeof dto?.delta !== 'number' || !Number.isInteger(dto.delta) || dto.delta === 0 || Math.abs(dto.delta) > MAX_QTY) {
      throw new BadRequestException('delta must be a non-zero whole number');
    }
    const reason = validateText('reason', dto?.reason, 300, true) as string;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Never below zero: the decrement only matches while enough stock remains.
      const res = await tx.asset.updateMany({
        where: dto.delta < 0 ? { id, quantity: { gte: -dto.delta } } : { id },
        data: { quantity: dto.delta < 0 ? { decrement: -dto.delta } : { increment: dto.delta } },
      });
      if (res.count !== 1) throw new ConflictException('There is not enough stock for that adjustment.');
      const row = await tx.asset.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'quantity_adjusted', actorId: user.userId, fromValue: String(row.quantity - dto.delta), toValue: String(row.quantity), note: reason }) });
      return row;
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_quantity_adjust', entityType: 'asset', entityId: id, newValue: { delta: dto.delta } });
    return this.present(updated, user);
  }

  // ---- documents (reuses the documents table; only metadata is exposed, never storage names) ----

  async listDocuments(id: string, user: any) {
    await this.access.loadAsset(id, user);
    const links = await this.prisma.assetDocument.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' } });
    const docs = links.length ? await this.prisma.documentEntity.findMany({ where: { id: { in: links.map((l) => l.document_id) } }, select: { id: true, title: true, mime_type: true, uploaded_at: true } }) : [];
    return links.map((l) => ({ id: l.id, documentId: l.document_id, label: l.label, attachedAt: l.created_at, document: docs.find((d) => d.id === l.document_id) ?? null }));
  }

  async attachDocument(id: string, dto: any, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_DOCUMENTS_MANAGE);
    const asset = await this.access.loadAsset(id, user);
    const documentId = validateRequiredUuid('documentId', dto?.documentId);
    const label = validateText('label', dto?.label, 100);
    const doc = await this.access.assertDocument(documentId, asset.fellowship_id);
    try {
      const link = await this.prisma.$transaction(async (tx) => {
        const created = await tx.assetDocument.create({ data: { fellowship_id: asset.fellowship_id, asset_id: id, document_id: documentId, label, attached_by: user.userId } });
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'document_attached', actorId: user.userId, note: doc.title }) });
        return created;
      });
      await this.auditService.log({ userId: user.userId, action: 'resources.asset_document_attach', entityType: 'asset', entityId: id });
      return link;
    } catch (err: any) {
      if (err?.code === 'P2002') throw new ConflictException('This document is already attached.');
      throw err;
    }
  }

  async removeDocument(id: string, linkId: string, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_DOCUMENTS_MANAGE);
    const asset = await this.access.loadAsset(id, user);
    if (!isUuid(linkId)) throw new NotFoundException('Attachment not found');
    const res = await this.prisma.$transaction(async (tx) => {
      const del = await tx.assetDocument.deleteMany({ where: { id: linkId, asset_id: id } });
      if (del.count === 1) {
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'document_removed', actorId: user.userId }) });
      }
      return del;
    });
    if (res.count !== 1) throw new NotFoundException('Attachment not found');
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_document_remove', entityType: 'asset', entityId: id });
    return { message: 'Attachment removed' };
  }

  // ---- history (append-only; no write API exists for it) ----

  async history(id: string, user: any) {
    await this.access.loadAsset(id, user);
    const rows = await this.prisma.assetHistory.findMany({ where: { asset_id: id }, orderBy: { occurred_at: 'desc' }, take: 300 });
    const ids = (f: 'member_id' | 'from_department_id' | 'to_department_id' | 'from_location_id' | 'to_location_id' | 'actor_id') =>
      Array.from(new Set(rows.map((r) => r[f]).filter((v): v is string => !!v)));
    const [members, depts, locs, actors] = await Promise.all([
      this.prisma.member.findMany({ where: { id: { in: ids('member_id') } }, select: { id: true, full_name: true } }),
      this.prisma.department.findMany({ where: { id: { in: [...ids('from_department_id'), ...ids('to_department_id')] } }, select: { id: true, name: true } }),
      this.prisma.assetLocation.findMany({ where: { id: { in: [...ids('from_location_id'), ...ids('to_location_id')] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: ids('actor_id') } }, select: { id: true, first_name: true, last_name: true } }),
    ]);
    const nm = (list: any[], key: string, id: string | null) => (id ? list.find((x) => x.id === id)?.[key] ?? null : null);
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      occurredAt: r.occurred_at,
      actor: r.actor_id ? `${actors.find((a) => a.id === r.actor_id)?.first_name ?? ''} ${actors.find((a) => a.id === r.actor_id)?.last_name ?? ''}`.trim() || null : null,
      member: nm(members, 'full_name', r.member_id),
      fromDepartment: nm(depts, 'name', r.from_department_id),
      toDepartment: nm(depts, 'name', r.to_department_id),
      fromLocation: nm(locs, 'name', r.from_location_id),
      toLocation: nm(locs, 'name', r.to_location_id),
      fromValue: r.from_value,
      toValue: r.to_value,
      note: r.note,
    }));
  }
}
