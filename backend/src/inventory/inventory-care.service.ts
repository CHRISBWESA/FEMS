import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAttachments } from '../department-workspace/department.util';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance/finance.validation';
import { D, money, nextNumber } from '../finance/accounting/ledger';
import { ExpensesFlowService } from '../finance/accounting/expenses-flow.service';
import { FinanceNotifyService } from '../finance/accounting/finance-notify.service';
import { InventoryScopeService } from './inventory-scope.service';
import { CONDITIONS, InventoryAssetsService } from './inventory-assets.service';
import { restingStatus } from './inventory-sync';

const INCIDENTS = ['lost', 'damaged', 'missing', 'unusable'];
const DAY = 86_400_000;

/**
 * Maintenance and repairs, loss/damage/disposal cases, consumable stock, and reminders. Repairs are paid through
 * Finance - one linked expense, following Finance's own approval rules - and never recorded twice.
 */
@Injectable()
export class InventoryCareService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: InventoryScopeService,
    private assets: InventoryAssetsService,
    private expenses: ExpensesFlowService,
    private notify: FinanceNotifyService,
  ) {}

  // ===================== maintenance =====================

  /** Anyone who can see the resource (incl. the department holding an assigned asset) reports a problem. */
  async reportMaintenance(user: any, assetId: string, b: any) {
    const a = await this.scope.loadVisible(user, assetId);
    if (['disposed', 'lost', 'retired'].includes(a.status)) throw new ConflictException('This resource is no longer in service.');
    const description = validateText('description', b?.description, 1000, true) as string;
    const type = ['repair', 'inspection', 'scheduled'].includes(b?.type) ? b.type : 'repair';
    const est = b?.estimatedCost === undefined || b.estimatedCost === '' ? null : validateAmount('estimatedCost', b.estimatedCost);
    const led = await this.scope.leaderships(user);
    const dept = a.assigned_department_id && led.has(a.assigned_department_id) ? a.assigned_department_id : a.owning_department_id;
    const m = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetMaintenance.create({ data: {
        fellowship_id: a.fellowship_id, asset_id: assetId, type, status: 'reported', scheduled_for: new Date(), description,
        notes: validateText('notes', b?.notes, 1000), estimated_cost: est, reported_by: user.userId, department_id: dept,
        attachments: validateAttachments('attachments', b?.attachments ?? []) as any, created_by: user.userId,
      } });
      await this.assets.history(tx, a, 'maintenance_reported', user.userId, { note: description.slice(0, 300) });
      return row;
    });
    await this.assets.notifyAll(await this.scope.managers(a), user.userId, a, 'maintenance_required', 'Maintenance needed', `${a.name} (${a.asset_tag}): ${description.slice(0, 120)}`);
    return m;
  }

  private async loadMaint(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Maintenance record not found');
    const m = await this.prisma.assetMaintenance.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!m) throw new NotFoundException('Maintenance record not found');
    const a = await this.scope.loadManaged(user, m.asset_id);
    return { m, a };
  }

  /**
   * The manager reviews a report: approve (optionally sending the repair cost to Finance as an expense, which then
   * follows Finance's approval route - routine or central) or reject.
   */
  async reviewMaintenance(user: any, id: string, b: any) {
    const { m, a } = await this.loadMaint(user, id);
    if (!['reported', 'pending_review'].includes(m.status)) throw new ConflictException('This report has already been reviewed.');
    if (b?.decision === 'rejected') {
      await this.prisma.assetMaintenance.update({ where: { id }, data: { status: 'cancelled', notes: validateText('comment', b?.comment, 500, true) } });
      if (m.reported_by) await this.assets.notifyAll([m.reported_by], user.userId, a, 'maintenance_rejected', 'Maintenance report closed', `${a.name}: ${b?.comment}`);
      return this.prisma.assetMaintenance.findUnique({ where: { id } });
    }
    const est = b?.estimatedCost === undefined || b.estimatedCost === '' ? (m.estimated_cost ? money(m.estimated_cost) : null) : validateAmount('estimatedCost', b.estimatedCost);
    const technician = validateText('technician', b?.technician, 200);
    const scheduled = validateDate('scheduledFor', b?.scheduledFor, { required: false, maxFutureDays: 366 }) ?? new Date();
    let expenseId: string | null = null;
    if (b?.createExpense === true) {
      if (!est) throw new BadRequestException('Enter the estimated repair cost to send it to Finance.');
      const e = await this.expenses.create(user, {
        scope: a.owning_department_id ? 'department' : undefined, departmentId: a.owning_department_id ?? undefined,
        title: `Repair: ${a.name} (${a.asset_tag})`, amount: Number(est), date: new Date().toISOString(), purpose: 'Resource repair', payee: technician ?? undefined,
        description: m.description, budgetLineId: b?.budgetLineId, attachments: m.attachments,
      });
      expenseId = e.id;
    }
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.assetMaintenance.updateMany({ where: { id, status: { in: ['reported', 'pending_review'] } }, data: { status: 'approved', approved_by: user.userId, approved_at: new Date(), technician, performed_by: technician, estimated_cost: est, scheduled_for: scheduled, expense_id: expenseId } });
      if (done.count !== 1) throw new ConflictException('This report has already been reviewed.');
      await this.assets.history(tx, a, 'maintenance_approved', user.userId, { note: `${technician ? `Technician: ${technician}. ` : ''}${expenseId ? 'Repair cost sent to Finance.' : ''}` });
    });
    return this.prisma.assetMaintenance.findUnique({ where: { id } });
  }

  /** Links a repair to an EXISTING Finance expense (instead of creating one). One expense, one repair. */
  async linkExpense(user: any, id: string, b: any) {
    const { m, a } = await this.loadMaint(user, id);
    if (m.expense_id) throw new ConflictException('This repair is already linked to an expense.');
    const expenseId = validateOptionalUuid('expenseId', b?.expenseId);
    if (!expenseId) throw new BadRequestException('expenseId is required');
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, fellowship_id: a.fellowship_id }, include: { account: { select: { department_id: true } } } });
    if (!e || e.reversed_at) throw new BadRequestException('The expense is not available.');
    if (e.account && (e.account.department_id ?? null) !== (a.owning_department_id ?? null)) throw new BadRequestException('The expense was paid from a different fund than the resource\'s owner.');
    const used = await this.prisma.assetMaintenance.findFirst({ where: { expense_id: expenseId } });
    if (used) throw new ConflictException('That expense already pays for another repair.');
    return this.prisma.assetMaintenance.update({ where: { id }, data: { expense_id: expenseId } });
  }

  async startMaintenance(user: any, id: string) {
    const { m, a } = await this.loadMaint(user, id);
    if (!['approved', 'scheduled'].includes(m.status)) throw new ConflictException('Only approved maintenance can start.');
    const out = await this.prisma.resourceRequest.count({ where: { asset_id: a.id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] } } });
    if (out || a.status === 'checked_out') throw new ConflictException('The resource is out on loan; it can go for repair once it is back.');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.assetMaintenance.updateMany({ where: { id, status: m.status }, data: { status: 'in_progress', started_at: new Date() } });
      if (done.count !== 1) throw new ConflictException('This maintenance changed; refresh.');
      await tx.asset.update({ where: { id: a.id }, data: { status: 'in_maintenance', condition: m.type === 'repair' ? 'under_repair' : a.condition } });
      await this.assets.history(tx, a, 'maintenance_started', user.userId, { from_value: a.status, to_value: 'in_maintenance' });
    });
    return this.prisma.assetMaintenance.findUnique({ where: { id } });
  }

  async completeMaintenance(user: any, id: string, b: any) {
    const { m, a } = await this.loadMaint(user, id);
    if (m.status !== 'in_progress') throw new ConflictException('Only maintenance in progress can be completed.');
    const after = CONDITIONS.includes(b?.conditionAfter) ? b.conditionAfter : 'good';
    const cost = b?.actualCost === undefined || b.actualCost === '' ? null : validateAmount('actualCost', b.actualCost, { allowZero: true });
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.assetMaintenance.updateMany({ where: { id, status: 'in_progress' }, data: { status: 'completed', completed_at: new Date(), cost, condition_after: after as any, notes: validateText('notes', b?.notes, 1000) ?? m.notes } });
      if (done.count !== 1) throw new ConflictException('This maintenance changed; refresh.');
      await tx.asset.update({ where: { id: a.id }, data: { status: await restingStatus(tx, a.id), condition: after as any, last_inspected_at: new Date() } });
      await this.assets.history(tx, a, 'maintenance_completed', user.userId, { to_value: after, note: cost ? `Cost ${cost}` : null });
    });
    if (m.reported_by) await this.assets.notifyAll([m.reported_by], user.userId, a, 'maintenance_completed', 'Repair completed', `${a.name} (${a.asset_tag}) is back in service.`);
    return this.prisma.assetMaintenance.findUnique({ where: { id } });
  }

  async cancelMaintenance(user: any, id: string) {
    const { m, a } = await this.loadMaint(user, id);
    if (['completed', 'cancelled'].includes(m.status)) throw new ConflictException('This maintenance is already closed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.assetMaintenance.update({ where: { id }, data: { status: 'cancelled' } });
      if (m.status === 'in_progress') await tx.asset.update({ where: { id: a.id }, data: { status: await restingStatus(tx, a.id) } });
      await this.assets.history(tx, a, 'maintenance_cancelled', user.userId);
    });
    return this.prisma.assetMaintenance.findUnique({ where: { id } });
  }

  async listMaintenance(user: any, q: any) {
    const assetWhere = await this.scope.listWhere(user, q?.departmentId);
    const ids = (await this.prisma.asset.findMany({ where: assetWhere, select: { id: true } })).map((x) => x.id);
    const where: any = { asset_id: { in: ids } };
    if (q?.status) where.status = String(q.status);
    const rows = await this.prisma.assetMaintenance.findMany({ where, orderBy: { created_at: 'desc' }, take: 300, include: { asset: { select: { id: true, name: true, asset_tag: true, owning_department_id: true } } } });
    return rows.map((m) => ({ ...m, cost: m.cost ? money(m.cost) : null, estimated_cost: m.estimated_cost ? money(m.estimated_cost) : null }));
  }

  // ===================== incidents: loss, damage, disposal =====================

  async reportIncident(user: any, assetId: string, b: any) {
    const a = await this.scope.loadVisible(user, assetId);
    if (['disposed'].includes(a.status)) throw new ConflictException('This resource has already been disposed of.');
    const type = b?.incidentType;
    if (!INCIDENTS.includes(type)) throw new BadRequestException(`incidentType must be one of: ${INCIDENTS.join(', ')}`);
    const description = validateText('description', b?.description, 2000, true) as string;
    const occurred = (validateDate('occurredAt', b?.occurredAt, { required: false }) ?? new Date()) as Date;
    const action = ['repair', 'write_off', 'dispose', 'recover', 'none'].includes(b?.proposedAction) ? b.proposedAction : type === 'damaged' ? 'repair' : 'recover';
    const led = await this.scope.leaderships(user);
    const dept = a.assigned_department_id && led.has(a.assigned_department_id) ? a.assigned_department_id : a.owning_department_id;
    const inc = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetIncident.create({ data: { fellowship_id: a.fellowship_id!, incident_number: await nextNumber(tx, a.fellowship_id!, 'asset_incident', 'INC'), asset_id: assetId, incident_type: type, description, occurred_at: occurred, reported_by: user.userId, department_id: dept, proposed_action: action, attachments: validateAttachments('attachments', b?.attachments ?? []) as any } });
      if (type === 'damaged' || type === 'unusable') await tx.asset.update({ where: { id: assetId }, data: { condition: 'damaged' } });
      await this.assets.history(tx, a, 'incident_reported', user.userId, { from_value: a.condition, to_value: type, note: `${row.incident_number}: ${description.slice(0, 300)}` });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'resources.incident_reported', entity_type: 'asset', entity_id: assetId, fellowship_id: a.fellowship_id, new_value: { type, incident: row.incident_number } as any } });
      return row;
    });
    const holders = a.assigned_department_id ? await this.scope.departmentLeaderIds(a.assigned_department_id) : [];
    await this.assets.notifyAll([...(await this.scope.managers(a)), ...holders, ...(await this.scope.usersWithRoles(a.fellowship_id!, ['treasurer']))], user.userId, a, `resource_${type}`, `Resource ${type}`, `${a.name} (${a.asset_tag}) was reported ${type}.`);
    return inc;
  }

  private async loadIncident(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Case not found');
    const inc = await this.prisma.assetIncident.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!inc) throw new NotFoundException('Case not found');
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id: inc.asset_id } });
    return { inc, a };
  }

  async updateIncident(user: any, id: string, b: any) {
    const { inc, a } = await this.loadIncident(user, id);
    if (!(await this.scope.canManage(user, a))) throw new ForbiddenException('Only the resource\'s manager investigates.');
    if (['CLOSED', 'PENDING_APPROVAL'].includes(inc.status)) throw new ConflictException('This case can no longer be changed.');
    const data: any = {};
    if (b?.investigationNotes !== undefined) data.investigation_notes = validateText('investigationNotes', b.investigationNotes, 3000);
    if (b?.proposedAction !== undefined) {
      if (!['repair', 'write_off', 'dispose', 'recover', 'none'].includes(b.proposedAction)) throw new BadRequestException('proposedAction is not valid');
      data.proposed_action = b.proposedAction;
    }
    if (b?.attachments !== undefined) data.attachments = validateAttachments('attachments', b.attachments);
    return this.prisma.assetIncident.update({ where: { id }, data });
  }

  /** Closing without disposal: found, repaired, or no action. Requires an outcome. */
  async closeIncident(user: any, id: string, b: any) {
    const { inc, a } = await this.loadIncident(user, id);
    if (!(await this.scope.canManage(user, a))) throw new ForbiddenException('Only the resource\'s manager closes a case.');
    if (!['OPEN', 'RETURNED', 'REJECTED'].includes(inc.status)) throw new ConflictException('This case cannot be closed now.');
    const outcome = validateText('outcome', b?.outcome, 1000, true) as string;
    await this.prisma.$transaction(async (tx) => {
      await tx.assetIncident.update({ where: { id }, data: { status: 'CLOSED', outcome, closed_at: new Date(), closed_by: user.userId } });
      await this.assets.history(tx, a, 'updated', user.userId, { note: `${inc.incident_number} closed: ${outcome.slice(0, 200)}` });
    });
    return this.prisma.assetIncident.findUnique({ where: { id } });
  }

  /**
   * Disposal or write-off. Fellowship resources: the Treasurer recommends, the Secretary reviews, the Chairperson
   * approves. A department's: its Chairperson then the Treasurer; significant ones also need the Secretary and
   * Chairperson. The asset is never deleted.
   */
  async requestDisposal(user: any, assetId: string, b: any) {
    const a = await this.scope.loadManaged(user, assetId);
    if (['disposed'].includes(a.status)) throw new ConflictException('This resource has already been disposed of.');
    if (a.ownership_type === 'borrowed') throw new BadRequestException('A borrowed resource is not ours to dispose of; return it or settle with its owner.');
    const action = b?.proposedAction === 'write_off' ? 'write_off' : 'dispose';
    const description = validateText('description', b?.description, 2000, true) as string;
    const method = validateText('disposalMethod', b?.disposalMethod, 100);
    const existing = await this.prisma.assetIncident.findFirst({ where: { asset_id: assetId, status: 'PENDING_APPROVAL' } });
    if (existing) throw new ConflictException('A disposal for this resource is already waiting for approval.');
    let incidentId = validateOptionalUuid('incidentId', b?.incidentId);
    const settings = await this.assets.settings(a.fellowship_id!);
    const value = D(a.estimated_value ?? a.acquisition_cost ?? 0);
    let workflow = 'asset_disposal';
    let skipFirst = false;
    if (a.owning_department_id) {
      const major = settings.major_disposal_value ? value.greaterThanOrEqualTo(settings.major_disposal_value) : false;
      workflow = major ? 'asset_disposal_major' : 'asset_disposal_department';
      skipFirst = (await this.scope.leaderships(user)).get(a.owning_department_id) === 'department_chairperson';
    }
    const approval = await this.prisma.$transaction(async (tx) => {
      let inc: any;
      if (incidentId) {
        inc = await tx.assetIncident.findFirst({ where: { id: incidentId, asset_id: assetId, status: { in: ['OPEN', 'RETURNED', 'REJECTED'] } } });
        if (!inc) throw new BadRequestException('That case is not open for this resource.');
        inc = await tx.assetIncident.update({ where: { id: inc.id }, data: { proposed_action: action, disposal_method: method, investigation_notes: [inc.investigation_notes, description].filter(Boolean).join('\n'), status: 'PENDING_APPROVAL' } });
      } else {
        inc = await tx.assetIncident.create({ data: { fellowship_id: a.fellowship_id!, incident_number: await nextNumber(tx, a.fellowship_id!, 'asset_incident', 'INC'), asset_id: assetId, incident_type: 'disposal', description, occurred_at: new Date(), reported_by: user.userId, department_id: a.owning_department_id, proposed_action: action, disposal_method: method, attachments: validateAttachments('attachments', b?.attachments ?? []) as any, status: 'PENDING_APPROVAL' } });
        incidentId = inc.id;
      }
      const wf = await this.engine.createWorkflow(workflow, inc.id, 'asset_incident', user.userId, { departmentId: a.owning_department_id, assetId, value: value.toFixed(2) }, a.fellowship_id, tx, { skipFirstStage: skipFirst });
      await tx.assetIncident.update({ where: { id: inc.id }, data: { approval_workflow_id: wf.id } });
      await this.assets.history(tx, a, 'disposal_requested', user.userId, { note: `${inc.incident_number}: ${action.replace('_', ' ')}` });
      return this.engine.submit(wf.id, tx, user.userId);
    });
    await this.notify.stage(approval, 'resource disposal', 'asset', assetId, user.userId);
    return this.prisma.assetIncident.findUnique({ where: { id: incidentId! } });
  }

  async listIncidents(user: any, q: any) {
    const assetWhere = await this.scope.listWhere(user, q?.departmentId);
    const ids = (await this.prisma.asset.findMany({ where: assetWhere, select: { id: true } })).map((x) => x.id);
    const where: any = { asset_id: { in: ids } };
    if (q?.status) where.status = String(q.status);
    if (q?.type) where.incident_type = String(q.type);
    const rows = await this.prisma.assetIncident.findMany({ where, orderBy: { created_at: 'desc' }, take: 300 });
    const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: rows.map((r) => r.asset_id) } }, select: { id: true, name: true, asset_tag: true } })).map((a) => [a.id, a]));
    return rows.map((r) => ({ ...r, asset: assets.get(r.asset_id) }));
  }

  // ===================== consumable stock =====================

  private async consumable(user: any, id: string) {
    const a = await this.scope.loadManaged(user, id);
    if (!a.is_consumable) throw new BadRequestException('This is not a consumable stock item.');
    return a;
  }

  private async move(tx: Prisma.TransactionClient, a: any, kind: string, qty: number, user: any, extra: Record<string, any> = {}) {
    const rows = qty < 0
      ? await tx.$queryRaw<{ quantity: number }[]>`UPDATE "assets" SET "quantity" = "quantity" + ${qty}, "updated_at" = now() WHERE "id" = ${a.id}::uuid AND "quantity" + ${qty} >= 0 RETURNING "quantity"`
      : await tx.$queryRaw<{ quantity: number }[]>`UPDATE "assets" SET "quantity" = "quantity" + ${qty}, "updated_at" = now() WHERE "id" = ${a.id}::uuid RETURNING "quantity"`;
    if (rows.length !== 1) {
      const fresh = await tx.asset.findUnique({ where: { id: a.id }, select: { quantity: true } });
      throw new ConflictException(`Only ${fresh?.quantity ?? 0} ${a.unit ?? 'units'} in stock.`);
    }
    await tx.stockMovement.create({ data: { fellowship_id: a.fellowship_id, asset_id: a.id, kind, quantity: qty, balance_after: Number(rows[0].quantity), created_by: user.userId, ...extra } });
    await this.assets.history(tx, a, kind === 'received' || kind === 'transfer_in' ? 'stock_received' : kind === 'adjusted' ? 'stock_adjusted' : kind === 'issued' ? 'stock_issued' : 'stock_transferred', user.userId, { from_value: String(Number(rows[0].quantity) - qty), to_value: String(rows[0].quantity), note: extra.reason ?? null });
    return Number(rows[0].quantity);
  }

  private qty(v: unknown) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new BadRequestException('quantity must be a whole number of at least 1');
    return n;
  }

  async receiveStock(user: any, id: string, b: any) {
    const a = await this.consumable(user, id);
    const q = this.qty(b?.quantity);
    await this.prisma.$transaction((tx) => this.move(tx, a, 'received', q, user, { reference: validateText('reference', b?.reference, 100), reason: validateText('reason', b?.reason, 300) }));
    return this.assets.detail(user, id);
  }

  /** Issued stock leaves the store; more than is held can never be issued. */
  async issueStock(user: any, id: string, b: any) {
    const a = await this.consumable(user, id);
    const q = this.qty(b?.quantity);
    const memberId = validateOptionalUuid('memberId', b?.memberId);
    const departmentId = validateOptionalUuid('departmentId', b?.departmentId);
    const left = await this.prisma.$transaction((tx) => this.move(tx, a, 'issued', -q, user, { member_id: memberId, department_id: departmentId, reason: validateText('reason', b?.reason, 300) }));
    await this.lowStock(a, left, user.userId);
    return this.assets.detail(user, id);
  }

  /** A counted correction (stock-take). Needs a reason; cannot take stock below zero. */
  async adjustStock(user: any, id: string, b: any) {
    const a = await this.consumable(user, id);
    const n = Number(b?.quantity);
    if (!Number.isInteger(n) || n === 0) throw new BadRequestException('quantity must be a non-zero whole number (negative to reduce)');
    const reason = validateText('reason', b?.reason, 300, true) as string;
    const left = await this.prisma.$transaction((tx) => this.move(tx, a, 'adjusted', n, user, { reason }));
    if (n < 0) await this.lowStock(a, left, user.userId);
    return this.assets.detail(user, id);
  }

  /** Stock moves between the fellowship's store and a department's (never directly between two departments). */
  async transferStock(user: any, id: string, b: any) {
    const a = await this.consumable(user, id);
    const q = this.qty(b?.quantity);
    const to = b?.toDepartmentId === 'central' || !b?.toDepartmentId ? null : validateOptionalUuid('toDepartmentId', b.toDepartmentId);
    if ((to ?? null) === (a.owning_department_id ?? null)) throw new BadRequestException('Choose a different store.');
    if (a.owning_department_id && to) throw new ForbiddenException('Stock cannot move directly between two departments; go through the fellowship store.');
    if (to) await this.scope.department(user, to);
    const reason = validateText('reason', b?.reason, 300);
    await this.prisma.$transaction(async (tx) => {
      let dest = await tx.asset.findFirst({ where: { fellowship_id: a.fellowship_id, is_consumable: true, owning_department_id: to, name: { equals: a.name, mode: 'insensitive' }, status: { notIn: ['disposed', 'retired'] } } });
      if (!dest) {
        const settings = await this.assets.settings(a.fellowship_id!);
        dest = await tx.asset.create({ data: { fellowship_id: a.fellowship_id, asset_tag: await nextNumber(tx, a.fellowship_id!, 'asset', settings.tag_prefix), name: a.name, description: a.description, category_id: a.category_id, unit: a.unit, is_consumable: true, quantity: 0, reorder_level: a.reorder_level, ownership_type: to ? 'department' : 'fellowship', owning_department_id: to, acquisition_method: 'transfer', created_by: user.userId } });
        await this.assets.history(tx, dest, 'created', user.userId, { note: `Stock store created by a transfer from ${a.asset_tag}` });
      }
      await this.move(tx, a, 'transfer_out', -q, user, { related_asset_id: dest.id, department_id: to, reason });
      await this.move(tx, dest, 'transfer_in', q, user, { related_asset_id: a.id, department_id: to, reason });
    });
    return this.assets.detail(user, id);
  }

  async movements(user: any, id: string) {
    await this.scope.loadVisible(user, id);
    return this.prisma.stockMovement.findMany({ where: { asset_id: id }, orderBy: { created_at: 'desc' }, take: 300 });
  }

  private async lowStock(a: any, left: number, actor: string) {
    if (a.reorder_level === null || a.reorder_level === undefined || left > a.reorder_level) return;
    const s = await this.assets.settings(a.fellowship_id);
    if (!s.low_stock_notifications) return;
    await this.assets.notifyAll(await this.scope.managers(a), actor, a, 'low_stock', 'Low stock', `${a.name}: ${left} ${a.unit ?? 'units'} left (reorder at ${a.reorder_level}).`);
  }

  // ===================== reminders =====================

  /** Upcoming and overdue returns, overdue borrowed-in items, and low stock. Each loan reminded at most daily. */
  async runReminders(user: any) {
    const fellowshipId = this.scope.fellowship(user);
    if (!this.scope.isTreasurer(user) && !this.scope.isCentralViewer(user)) throw new ForbiddenException('Only central officers send resource reminders.');
    const s = await this.assets.settings(fellowshipId);
    const now = new Date();
    const soon = new Date(now.getTime() + s.return_reminder_days * DAY);
    const res = { upcoming: 0, overdue: 0, borrowedIn: 0, lowStock: 0 };
    const loans = await this.prisma.resourceRequest.findMany({ where: { fellowship_id: fellowshipId, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] }, needed_until: { lte: soon }, OR: [{ last_reminded_at: null }, { last_reminded_at: { lt: new Date(now.getTime() - DAY) } }] }, take: 500 });
    for (const r of loans) {
      const claim = await this.prisma.resourceRequest.updateMany({ where: { id: r.id, OR: [{ last_reminded_at: null }, { last_reminded_at: { lt: new Date(now.getTime() - DAY) } }] }, data: { last_reminded_at: now } });
      if (claim.count !== 1) continue;
      const a = await this.prisma.asset.findUniqueOrThrow({ where: { id: r.asset_id } });
      const overdue = r.needed_until < now;
      const to = [r.requester_user_id, ...(r.department_id ? await this.scope.departmentLeaderIds(r.department_id) : []), ...(overdue ? await this.scope.managers(a) : [])];
      await this.assets.notifyAll(to, user.userId, a, overdue ? 'resource_overdue' : 'resource_due_soon', overdue ? 'Resource overdue' : 'Resource due back soon', `${a.name} (${r.request_number}) ${overdue ? 'was due back on' : 'is due back on'} ${r.needed_until.toISOString().slice(0, 10)}.`);
      if (overdue) res.overdue++; else res.upcoming++;
    }
    const borrowed = await this.prisma.asset.findMany({ where: { fellowship_id: fellowshipId, ownership_type: 'borrowed', actual_return_date: null, expected_return_date: { lte: soon }, status: { notIn: ['retired', 'disposed'] } } });
    for (const a of borrowed) {
      await this.assets.notifyAll(await this.scope.managers(a), user.userId, a, 'borrowed_return_due', 'Return a borrowed resource', `${a.name} must go back to ${a.external_owner_name} by ${a.expected_return_date!.toISOString().slice(0, 10)}.`);
      res.borrowedIn++;
    }
    if (s.low_stock_notifications) {
      const low = await this.prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "assets" WHERE "fellowship_id" = ${fellowshipId}::uuid AND "is_consumable" = true AND "reorder_level" IS NOT NULL AND "quantity" <= "reorder_level" AND "status" NOT IN ('retired', 'disposed')`;
      for (const { id } of low) {
        const a = await this.prisma.asset.findUniqueOrThrow({ where: { id } });
        await this.assets.notifyAll(await this.scope.managers(a), user.userId, a, 'low_stock', 'Low stock', `${a.name}: ${a.quantity} ${a.unit ?? 'units'} left.`);
        res.lowStock++;
      }
    }
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'resources.reminders_run', entity_type: 'resources', fellowship_id: fellowshipId, new_value: res as any } });
    return res;
  }
}
