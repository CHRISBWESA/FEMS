import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import PDFDocument = require('pdfkit');
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAttachments } from '../department-workspace/department.util';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance/finance.validation';
import { money, nextNumber } from '../finance/accounting/ledger';
import { InventoryScopeService } from './inventory-scope.service';

export const CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'damaged', 'under_repair'];
const OWNERSHIP = ['fellowship', 'department', 'donated', 'borrowed'];
const METHODS = ['purchase', 'donation', 'transfer', 'borrowed', 'other'];
export const DEFAULT_CATEGORIES = [
  'Furniture', 'Computers and electronics', 'Musical instruments', 'Sound and audiovisual equipment', 'Projectors and presentation equipment',
  'Sports equipment', 'Vehicles and transport', 'Buildings and facilities', 'Office equipment', 'Kitchen equipment', 'Event equipment',
  'Consumable supplies', 'Other resources',
];

const condition = (field: string, v: unknown, required = false): any => {
  if (v === undefined || v === null || v === '') { if (required) throw new BadRequestException(`${field} is required`); return null; }
  if (!CONDITIONS.includes(v as string)) throw new BadRequestException(`${field} must be one of: ${CONDITIONS.join(', ')}`);
  return v;
};
const int = (field: string, v: unknown, min = 0) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 1_000_000) throw new BadRequestException(`${field} must be a whole number of at least ${min}`);
  return n;
};

/**
 * The resource register: fellowship-owned, department-owned, donated and borrowed resources, each with a unique
 * identification number, ownership, custody, condition, documents and a full history. Nothing is ever deleted.
 */
@Injectable()
export class InventoryAssetsService {
  constructor(private prisma: PrismaService, private scope: InventoryScopeService) {}

  async settings(fellowshipId: string) {
    return (await this.prisma.resourceSettings.findUnique({ where: { fellowship_id: fellowshipId } })) ?? {
      tag_prefix: 'AST', units: ['piece', 'set', 'box', 'pack', 'ream', 'litre', 'kg', 'metre'],
      maintenance_categories: ['repair', 'service', 'inspection', 'cleaning'], major_disposal_value: null, low_stock_notifications: true, return_reminder_days: 2,
    };
  }

  async history(tx: any, asset: { id: string; fellowship_id: string | null }, eventType: string, actor: string, extra: Record<string, any> = {}) {
    await tx.assetHistory.create({ data: { fellowship_id: asset.fellowship_id, asset_id: asset.id, event_type: eventType, actor_id: actor, ...extra } });
  }

  /**
   * A purchase must be paid from the owner's money: a department's resource from the department's own funds, a
   * fellowship resource from central funds. So a department cannot register a centrally funded purchase as its own.
   */
  private async checkPurchase(expenseId: string, fellowshipId: string, ownerDept: string | null) {
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, fellowship_id: fellowshipId }, include: { account: { select: { department_id: true } } } });
    if (!e || e.reversed_at || ['REJECTED', 'CANCELLED'].includes(e.approval_status)) throw new BadRequestException('The purchase expense is not available.');
    let fund: string | null = e.account ? e.account.department_id : null;
    if (!e.account && e.approval_workflow_id) {
      const wf = await this.prisma.approval.findUnique({ where: { id: e.approval_workflow_id }, select: { workflow_type: true, metadata: true } });
      if (wf?.workflow_type.startsWith('department_')) fund = (wf.metadata as any)?.departmentId ?? e.department_id;
    }
    if ((fund ?? null) !== (ownerDept ?? null)) {
      throw new BadRequestException(ownerDept
        ? 'This purchase was paid from central fellowship funds, so the resource belongs to the fellowship. Ask the Treasurer to assign it to your department.'
        : 'This purchase was paid from a department\'s own money; register it as that department\'s resource.');
    }
    return e;
  }

  async register(user: any, b: any) {
    const fellowshipId = this.scope.fellowship(user);
    const ownership = (b?.ownershipType ?? 'fellowship') as string;
    if (!OWNERSHIP.includes(ownership)) throw new BadRequestException(`ownershipType must be one of: ${OWNERSHIP.join(', ')}`);
    const departmentId = validateOptionalUuid('departmentId', b?.departmentId);
    if (ownership === 'department' && !departmentId) throw new BadRequestException('Choose the department that owns this resource.');
    if (ownership === 'fellowship' && departmentId) throw new BadRequestException('A fellowship resource has no owning department; assign it to a department after registering it.');
    await this.scope.requireManageScope(user, departmentId);

    const name = validateText('name', b?.name, 200, true) as string;
    const description = validateText('description', b?.description, 2000);
    const categoryId = validateOptionalUuid('categoryId', b?.categoryId);
    const locationId = validateOptionalUuid('locationId', b?.locationId);
    const custodian = validateOptionalUuid('custodianMemberId', b?.custodianMemberId);
    const expenseId = validateOptionalUuid('acquisitionExpenseId', b?.acquisitionExpenseId);
    const method = (validateText('acquisitionMethod', b?.acquisitionMethod, 20) ?? (ownership === 'donated' ? 'donation' : ownership === 'borrowed' ? 'borrowed' : 'purchase')) as string;
    if (!METHODS.includes(method)) throw new BadRequestException(`acquisitionMethod must be one of: ${METHODS.join(', ')}`);
    const isConsumable = b?.isConsumable === true;
    const quantity = b?.quantity === undefined || b.quantity === '' ? (isConsumable ? 0 : 1) : int('quantity', b.quantity, isConsumable ? 0 : 1);
    const settings = await this.settings(fellowshipId);
    const unit = validateText('unit', b?.unit, 20);
    if (unit && !settings.units.includes(unit)) throw new BadRequestException(`unit must be one of: ${settings.units.join(', ')}`);

    const data: Prisma.AssetUncheckedCreateInput = {
      fellowship_id: fellowshipId, asset_tag: '', name, description, category_id: categoryId, location_id: locationId,
      serial_number: validateText('serialNumber', b?.serialNumber, 100), ownership_type: ownership as any, owning_department_id: departmentId,
      acquisition_method: method, acquisition_source: validateText('acquisitionSource', b?.acquisitionSource, 200),
      acquisition_date: validateDate('acquisitionDate', b?.acquisitionDate, { required: false }) ?? null,
      condition: condition('condition', b?.condition) ?? 'good', custodian_member_id: custodian, notes: validateText('notes', b?.notes, 2000),
      is_consumable: isConsumable, quantity, unit, reorder_level: b?.reorderLevel === undefined || b.reorderLevel === '' ? null : int('reorderLevel', b.reorderLevel),
      storage_location: validateText('storageLocation', b?.storageLocation, 200),
      photos: validateAttachments('photos', b?.photos ?? []) as any, attachments: validateAttachments('attachments', b?.attachments ?? []) as any,
      created_by: user.userId,
    };
    if (ownership === 'borrowed') {
      // Borrowed from outside: whose it is and when it goes back. Never an owned asset, never a purchase.
      data.external_owner_name = validateText('externalOwnerName', b?.externalOwnerName, 200, true);
      data.external_owner_contact = validateText('externalOwnerContact', b?.externalOwnerContact, 200);
      data.borrowed_on = validateDate('borrowedOn', b?.borrowedOn) as Date;
      data.expected_return_date = validateDate('expectedReturnDate', b?.expectedReturnDate, { maxFutureDays: 3650 }) as Date;
      if (data.expected_return_date < data.borrowed_on) throw new BadRequestException('expectedReturnDate cannot be before borrowedOn');
      data.condition_received = condition('conditionReceived', b?.conditionReceived) ?? data.condition;
      if (expenseId || b?.acquisitionCost) throw new BadRequestException('A borrowed resource has no purchase cost.');
    } else if (ownership === 'donated' || method === 'donation') {
      // A donation is recorded with its estimated value; it is never cash income.
      data.donor_name = validateText('donorName', b?.donorName, 200);
      data.donor_contact = validateText('donorContact', b?.donorContact, 200);
      data.donation_date = validateDate('donationDate', b?.donationDate, { required: false }) ?? null;
      data.estimated_value = b?.estimatedValue === undefined || b.estimatedValue === '' ? null : validateAmount('estimatedValue', b.estimatedValue);
      if (expenseId || b?.acquisitionCost) throw new BadRequestException('A donated resource was not bought: record its estimated value instead of a cost.');
    } else {
      data.acquisition_cost = b?.acquisitionCost === undefined || b.acquisitionCost === '' ? null : validateAmount('acquisitionCost', b.acquisitionCost);
      data.estimated_value = b?.estimatedValue === undefined || b.estimatedValue === '' ? null : validateAmount('estimatedValue', b.estimatedValue);
      if (expenseId) {
        const e = await this.checkPurchase(expenseId, fellowshipId, departmentId);
        data.acquisition_expense_id = e.id;
        data.acquisition_cost = data.acquisition_cost ?? money(e.amount_paid ?? e.amount);
      }
    }
    if (categoryId && !(await this.prisma.assetCategory.findFirst({ where: { id: categoryId, fellowship_id: fellowshipId, is_active: true } }))) throw new BadRequestException('The selected category is not available.');
    if (locationId && !(await this.prisma.assetLocation.findFirst({ where: { id: locationId, fellowship_id: fellowshipId, is_active: true } }))) throw new BadRequestException('The selected location is not available.');
    if (custodian && !(await this.prisma.member.findFirst({ where: { id: custodian, fellowship_id: fellowshipId } }))) throw new BadRequestException('The custodian must be a registered member.');

    const asset = await this.prisma.$transaction(async (tx) => {
      data.asset_tag = await nextNumber(tx, fellowshipId, 'asset', settings.tag_prefix);
      const a = await tx.asset.create({ data });
      await this.history(tx, a, ownership === 'borrowed' ? 'borrowed_external' : 'created', user.userId, { to_department_id: departmentId, to_location_id: locationId, to_value: ownership, note: ownership === 'borrowed' ? `Borrowed from ${data.external_owner_name}` : null });
      if (isConsumable && quantity > 0) {
        await tx.stockMovement.create({ data: { fellowship_id: fellowshipId, asset_id: a.id, kind: 'received', quantity, balance_after: quantity, department_id: departmentId, reason: 'Opening stock', created_by: user.userId } });
      }
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'resources.register', entity_type: 'asset', entity_id: a.id, fellowship_id: fellowshipId, new_value: { tag: a.asset_tag, ownership, departmentId, expenseId } as any } });
      return a;
    });
    return this.detail(user, asset.id);
  }

  /** Descriptive fields only. Ownership, status and quantity change only through their own workflows. */
  async update(user: any, id: string, b: any) {
    const a = await this.scope.loadManaged(user, id);
    for (const forbidden of ['ownershipType', 'departmentId', 'owningDepartmentId', 'status', 'quantity', 'assignedDepartmentId']) {
      if (b?.[forbidden] !== undefined) throw new BadRequestException(`${forbidden} cannot be edited here; use the transfer, assignment or stock workflows.`);
    }
    if (['disposed', 'lost'].includes(a.status)) throw new ConflictException('A disposed or written-off resource is kept as history and cannot be edited.');
    const data: any = {};
    const text: [string, string, number][] = [['name', 'name', 200], ['description', 'description', 2000], ['serialNumber', 'serial_number', 100], ['notes', 'notes', 2000], ['storageLocation', 'storage_location', 200], ['acquisitionSource', 'acquisition_source', 200], ['donorName', 'donor_name', 200], ['donorContact', 'donor_contact', 200], ['externalOwnerContact', 'external_owner_contact', 200]];
    for (const [k, col, max] of text) if (b?.[k] !== undefined) data[col] = validateText(k, b[k], max, k === 'name');
    if (b?.categoryId !== undefined) {
      data.category_id = validateOptionalUuid('categoryId', b.categoryId);
      if (data.category_id && !(await this.prisma.assetCategory.findFirst({ where: { id: data.category_id, fellowship_id: a.fellowship_id, is_active: true } }))) throw new BadRequestException('The selected category is not available.');
    }
    if (b?.custodianMemberId !== undefined) {
      data.custodian_member_id = validateOptionalUuid('custodianMemberId', b.custodianMemberId);
      if (data.custodian_member_id && !(await this.prisma.member.findFirst({ where: { id: data.custodian_member_id, fellowship_id: a.fellowship_id } }))) throw new BadRequestException('The custodian must be a registered member.');
    }
    if (b?.estimatedValue !== undefined) data.estimated_value = b.estimatedValue === null || b.estimatedValue === '' ? null : validateAmount('estimatedValue', b.estimatedValue);
    if (b?.reorderLevel !== undefined) data.reorder_level = b.reorderLevel === null || b.reorderLevel === '' ? null : int('reorderLevel', b.reorderLevel);
    if (b?.expectedReturnDate !== undefined && a.ownership_type === 'borrowed') data.expected_return_date = validateDate('expectedReturnDate', b.expectedReturnDate, { maxFutureDays: 3650 });
    if (b?.photos !== undefined) data.photos = validateAttachments('photos', b.photos);
    if (b?.attachments !== undefined) data.attachments = validateAttachments('attachments', b.attachments);
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data });
      await this.history(tx, a, 'updated', user.userId, { note: `Updated: ${Object.keys(data).join(', ')}` });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'resources.update', entity_type: 'asset', entity_id: id, fellowship_id: a.fellowship_id, new_value: { fields: Object.keys(data) } as any } });
    });
    return this.detail(user, id);
  }

  /** An inspection: the condition as found. Damage or poor condition needs a reason. */
  async inspect(user: any, id: string, b: any) {
    const a = await this.scope.loadManaged(user, id);
    const next = condition('condition', b?.condition, true);
    const reason = validateText('reason', b?.reason, 500, ['damaged', 'poor', 'under_repair'].includes(next));
    if (['disposed', 'lost'].includes(a.status)) throw new ConflictException('This resource is no longer in service.');
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: { condition: next, last_inspected_at: new Date() } });
      await this.history(tx, a, 'condition_changed', user.userId, { from_value: a.condition, to_value: next, note: reason });
    });
    if (next === 'damaged') {
      const to = await this.scope.managers(a);
      const leaders = a.assigned_department_id ? await this.scope.departmentLeaderIds(a.assigned_department_id) : [];
      await this.notifyAll([...to, ...leaders], user.userId, a, 'resource_damaged', 'Resource damaged', `${a.name} (${a.asset_tag}) was found damaged.`);
    }
    return this.detail(user, id);
  }

  /** The borrowed resource goes back to its owner. Its record stays (it was never ours). */
  async returnToOwner(user: any, id: string, b: any) {
    const a = await this.scope.loadManaged(user, id);
    if (a.ownership_type !== 'borrowed') throw new BadRequestException('Only a borrowed resource is returned to its owner.');
    if (a.actual_return_date) throw new ConflictException('It has already been returned.');
    const open = await this.prisma.resourceRequest.count({ where: { asset_id: id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] } } });
    if (open) throw new ConflictException('It is still issued to someone; record that return first.');
    const cond = condition('conditionReturned', b?.conditionReturned, true);
    const when = (validateDate('returnedOn', b?.returnedOn, { required: false }) ?? new Date()) as Date;
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: { actual_return_date: when, condition_returned: cond, status: 'retired', retired_at: when, retired_reason: 'Returned to its owner' } });
      await this.history(tx, a, 'returned_external', user.userId, { to_value: cond, note: validateText('notes', b?.notes, 500) ?? `Returned to ${a.external_owner_name}` });
    });
    return this.detail(user, id);
  }

  async list(user: any, q: any) {
    const where: any = await this.scope.listWhere(user, q?.departmentId);
    const and: any[] = [];
    if (q?.ownership && OWNERSHIP.includes(q.ownership)) where.ownership_type = q.ownership;
    if (q?.categoryId && isUuid(q.categoryId)) where.category_id = q.categoryId;
    if (q?.condition && CONDITIONS.includes(q.condition)) where.condition = q.condition;
    if (q?.status) where.status = String(q.status);
    if (q?.consumable === 'true') where.is_consumable = true;
    if (q?.consumable === 'false') where.is_consumable = false;
    if (q?.custodianMemberId && isUuid(q.custodianMemberId)) where.custodian_member_id = q.custodianMemberId;
    if (q?.search) {
      const term = validateText('search', q.search, 100) as string;
      and.push({ OR: [{ name: { contains: term, mode: 'insensitive' } }, { asset_tag: { contains: term, mode: 'insensitive' } }, { serial_number: { contains: term, mode: 'insensitive' } }] });
    }
    const from = validateDate('from', q?.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q?.to, { required: false, maxFutureDays: 3650 });
    if (from || to) where.acquisition_date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (and.length) where.AND = and;
    const limit = Math.min(500, Math.max(1, Number(q?.limit) || 100));
    const page = Math.max(1, Number(q?.page) || 1);
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where, orderBy: [{ created_at: 'desc' }], take: limit, skip: (page - 1) * limit,
        include: { category: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, owning_department: { select: { id: true, name: true } }, custodian: { select: { id: true, full_name: true } } },
      }),
      this.prisma.asset.count({ where }),
    ]);
    const deptIds = Array.from(new Set(rows.map((r) => r.assigned_department_id).filter((x): x is string => !!x)));
    const depts = new Map((await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const seeCost = this.scope.isCentralViewer(user);
    return {
      data: await Promise.all(rows.map(async (r) => this.shape(r, { assignedName: r.assigned_department_id ? depts.get(r.assigned_department_id) ?? null : null, canManage: await this.scope.canManage(user, r), seeCost }))),
      total, page, limit,
    };
  }

  shape(a: any, x: { assignedName?: string | null; canManage?: boolean; seeCost?: boolean } = {}) {
    return {
      ...a,
      acquisition_cost: x.seeCost === false ? undefined : a.acquisition_cost ? money(a.acquisition_cost) : null,
      estimated_value: a.estimated_value ? money(a.estimated_value) : null,
      assignedDepartment: a.assigned_department_id ? { id: a.assigned_department_id, name: x.assignedName ?? null } : null,
      ownerLabel: a.ownership_type === 'borrowed' ? `Borrowed from ${a.external_owner_name}` : a.owning_department ? `${a.owning_department.name}${a.ownership_type === 'donated' ? ' (donated)' : ''}` : a.ownership_type === 'donated' ? 'Fellowship (donated)' : 'Fellowship',
      isOwned: a.ownership_type !== 'borrowed',
      overdueReturn: a.ownership_type === 'borrowed' && !a.actual_return_date && !!a.expected_return_date && a.expected_return_date < new Date(),
      canManage: x.canManage,
    };
  }

  async detail(user: any, id: string) {
    const a = await this.scope.loadVisible(user, id);
    const full = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: { category: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, owning_department: { select: { id: true, name: true } }, custodian: { select: { id: true, full_name: true } } },
    });
    const [assignments, transfers, requests, maintenance, incidents, stock, history, purchase] = await Promise.all([
      this.prisma.assetAssignment.findMany({ where: { asset_id: id }, orderBy: { handed_over_at: 'desc' } }),
      this.prisma.assetTransfer.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.resourceRequest.findMany({ where: { asset_id: id }, orderBy: { needed_from: 'desc' }, take: 50 }),
      this.prisma.assetMaintenance.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.assetIncident.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' } }),
      a.is_consumable ? this.prisma.stockMovement.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' }, take: 100 }) : [],
      this.prisma.assetHistory.findMany({ where: { asset_id: id }, orderBy: { occurred_at: 'desc' }, take: 200 }),
      a.acquisition_expense_id ? this.prisma.expense.findUnique({ where: { id: a.acquisition_expense_id }, select: { id: true, expense_number: true, title: true, amount: true, amount_paid: true, payment_status: true, paid_at: true } }) : null,
    ]);
    const repairIds = maintenance.map((m) => m.expense_id).filter((x): x is string => !!x);
    const repairs = repairIds.length ? await this.prisma.expense.findMany({ where: { id: { in: repairIds } }, select: { id: true, expense_number: true, title: true, amount: true, amount_paid: true, payment_status: true, approval_status: true } }) : [];
    const deptIds = Array.from(new Set([full.assigned_department_id, ...assignments.map((x) => x.department_id), ...transfers.flatMap((t) => [t.from_department_id, t.to_department_id]), ...requests.map((r) => r.department_id)].filter((x): x is string => !!x)));
    const depts = new Map((await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const seeCost = this.scope.isCentralViewer(user) || (await this.scope.canManage(user, a));
    return {
      ...this.shape(full, { assignedName: full.assigned_department_id ? depts.get(full.assigned_department_id) ?? null : null, canManage: await this.scope.canManage(user, a), seeCost }),
      departmentNames: Object.fromEntries(depts),
      assignments, transfers, requests, incidents,
      maintenance: maintenance.map((m) => ({ ...m, cost: m.cost ? money(m.cost) : null, estimated_cost: m.estimated_cost ? money(m.estimated_cost) : null })),
      stock, history,
      finance: {
        purchase: purchase && seeCost ? { ...purchase, amount: money(purchase.amount), amount_paid: purchase.amount_paid ? money(purchase.amount_paid) : null } : null,
        repairs: seeCost ? repairs.map((r) => ({ ...r, amount: money(r.amount), amount_paid: r.amount_paid ? money(r.amount_paid) : null })) : [],
      },
    };
  }

  /** A printable label with a QR code that opens the resource's page (for people allowed to see it). */
  async label(user: any, id: string): Promise<Buffer> {
    const a = await this.scope.loadVisible(user, id);
    const owner = a.owning_department_id ? (await this.prisma.department.findUnique({ where: { id: a.owning_department_id }, select: { name: true } }))?.name : null;
    const fellowship = (await this.prisma.fellowship.findUnique({ where: { id: a.fellowship_id! }, select: { name: true } }))?.name ?? '';
    const url = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/inventory/assets/${a.id}`;
    const qr = await QRCode.toBuffer(url, { margin: 1, width: 300 });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [288, 144], margin: 10 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.image(qr, 10, 12, { width: 120 });
      doc.font('Helvetica-Bold').fontSize(13).text(a.asset_tag, 140, 18, { width: 138 });
      doc.font('Helvetica').fontSize(9).text(a.name.slice(0, 80), 140, 38, { width: 138 });
      doc.fontSize(8).fillColor('#444').text(owner ? `Owner: ${owner}` : a.ownership_type === 'borrowed' ? `Borrowed from ${a.external_owner_name}` : `Owner: ${fellowship}`, 140, 80, { width: 138 });
      doc.text(fellowship, 140, 116, { width: 138 });
      doc.end();
    });
  }

  async notifyAll(userIds: string[], actor: string, asset: any, eventType: string, title: string, message: string) {
    for (const id of Array.from(new Set(userIds)).filter((x) => x && x !== actor)) {
      await this.prisma.notification.create({ data: { recipient_user_id: id, event_type: eventType, title, message, entity_type: 'asset', entity_id: asset.id, actor_user_id: actor, fellowship_id: asset.fellowship_id } }).catch(() => undefined);
    }
  }

  // ---------- categories, locations, settings ----------

  async categories(user: any, kind: 'category' | 'location') {
    const fellowshipId = this.scope.fellowship(user);
    if (!this.scope.isCentralViewer(user) && !(await this.scope.leaderships(user)).size) throw new ForbiddenException('You do not have permission to perform this action.');
    const model: any = kind === 'category' ? this.prisma.assetCategory : this.prisma.assetLocation;
    return model.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { name: 'asc' } });
  }

  async saveCategory(user: any, kind: 'category' | 'location', b: any, id?: string) {
    await this.scope.requireManageScope(user, null);
    const fellowshipId = this.scope.fellowship(user);
    const model: any = kind === 'category' ? this.prisma.assetCategory : this.prisma.assetLocation;
    const data: any = {};
    if (!id || b?.name !== undefined) data.name = validateText('name', b?.name, 120, true);
    if (b?.description !== undefined) data.description = validateText('description', b.description, 300);
    if (b?.isActive !== undefined) data.is_active = b.isActive === true;
    if (data.name) {
      const clash = await model.findFirst({ where: { fellowship_id: fellowshipId, name: { equals: data.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
      if (clash) throw new ConflictException('That name is already used.');
    }
    if (id) {
      if (!isUuid(id) || !(await model.findFirst({ where: { id, fellowship_id: fellowshipId } }))) throw new NotFoundException('Not found');
      return model.update({ where: { id }, data });
    }
    return model.create({ data: { ...data, fellowship_id: fellowshipId, created_by: user.userId } });
  }

  async addDefaultCategories(user: any) {
    await this.scope.requireManageScope(user, null);
    const fellowshipId = this.scope.fellowship(user);
    const existing = new Set((await this.prisma.assetCategory.findMany({ where: { fellowship_id: fellowshipId }, select: { name: true } })).map((c) => c.name.toLowerCase()));
    const missing = DEFAULT_CATEGORIES.filter((n) => !existing.has(n.toLowerCase()));
    for (const name of missing) await this.prisma.assetCategory.create({ data: { fellowship_id: fellowshipId, name, created_by: user.userId } });
    return { added: missing.length };
  }

  async getSettings(user: any) {
    const fellowshipId = this.scope.fellowship(user);
    const s = await this.settings(fellowshipId);
    return { ...s, major_disposal_value: s.major_disposal_value ? money(s.major_disposal_value) : null };
  }

  async updateSettings(user: any, b: any) {
    await this.scope.requireManageScope(user, null);
    const fellowshipId = this.scope.fellowship(user);
    const data: any = {};
    if (b?.tagPrefix !== undefined) {
      const p = validateText('tagPrefix', b.tagPrefix, 8, true) as string;
      if (!/^[A-Z0-9]{2,8}$/.test(p)) throw new BadRequestException('tagPrefix must be 2-8 capital letters or digits');
      data.tag_prefix = p;
    }
    for (const [k, col] of [['units', 'units'], ['maintenanceCategories', 'maintenance_categories']] as const) {
      if (b?.[k] !== undefined) {
        if (!Array.isArray(b[k]) || !b[k].length || b[k].length > 30) throw new BadRequestException(`${k} must list 1-30 values`);
        data[col] = Array.from(new Set(b[k].map((x: unknown) => validateText(k, x, 30, true) as string)));
      }
    }
    if (b?.majorDisposalValue !== undefined) data.major_disposal_value = b.majorDisposalValue === null || b.majorDisposalValue === '' ? null : validateAmount('majorDisposalValue', b.majorDisposalValue);
    if (b?.lowStockNotifications !== undefined) data.low_stock_notifications = b.lowStockNotifications === true;
    if (b?.returnReminderDays !== undefined) data.return_reminder_days = int('returnReminderDays', b.returnReminderDays, 0);
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    await this.prisma.resourceSettings.upsert({ where: { fellowship_id: fellowshipId }, update: { ...data, updated_by: user.userId }, create: { fellowship_id: fellowshipId, ...data, updated_by: user.userId } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'resources.settings_update', entity_type: 'resource_settings', fellowship_id: fellowshipId, new_value: { fields: Object.keys(data) } as any } });
    return this.getSettings(user);
  }
}
