import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAttachments } from '../department-workspace/department.util';
import { validateDate, validateOptionalUuid, validateRequiredUuid, validateText } from '../finance/finance.validation';
import { nextNumber } from '../finance/accounting/ledger';
import { FinanceNotifyService } from '../finance/accounting/finance-notify.service';
import { InventoryScopeService } from './inventory-scope.service';
import { CONDITIONS, InventoryAssetsService } from './inventory-assets.service';
import { restingStatus } from './inventory-sync';

const OUT_OF_SERVICE = ['disposed', 'lost', 'retired', 'in_maintenance'];
const HOLDING = ['APPROVED', 'ISSUED', 'PARTIALLY_RETURNED'];
const cond = (f: string, v: unknown) => { if (!CONDITIONS.includes(v as string)) throw new BadRequestException(`${f} must be one of: ${CONDITIONS.join(', ')}`); return v as any; };

/**
 * Assignments (custody, never ownership), transfers (moves, and approved ownership changes) and resource requests
 * (booking, handover and return). The same unavailable resource can never be booked or issued twice.
 */
@Injectable()
export class InventoryFlowsService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: InventoryScopeService,
    private assets: InventoryAssetsService,
    private notify: FinanceNotifyService,
  ) {}

  // ===================== assignments =====================

  /** The Treasurer hands a fellowship-owned resource to a department to use. Ownership does not change. */
  async assign(user: any, id: string, b: any) {
    const a = await this.scope.loadManaged(user, id);
    if (a.owning_department_id) throw new BadRequestException('Only fellowship resources are assigned to departments; a department\'s own resource stays with it.');
    if (a.is_consumable) throw new BadRequestException('Consumable stock is issued or transferred, not assigned.');
    if (OUT_OF_SERVICE.includes(a.status) || ['borrowed', 'checked_out'].includes(a.status)) throw new ConflictException(`The resource is ${a.status.replace('_', ' ')}.`);
    const departmentId = validateRequiredUuid('departmentId', b?.departmentId);
    await this.scope.department(user, departmentId);
    const responsible = validateOptionalUuid('responsibleMemberId', b?.responsibleMemberId);
    if (responsible && !(await this.prisma.member.findFirst({ where: { id: responsible, fellowship_id: a.fellowship_id } }))) throw new BadRequestException('The responsible person must be a registered member.');
    const toLocation = validateOptionalUuid('toLocationId', b?.toLocationId);
    if (toLocation && !(await this.prisma.assetLocation.findFirst({ where: { id: toLocation, fellowship_id: a.fellowship_id, is_active: true } }))) throw new BadRequestException('The selected location is not available.');
    const conditionAt = b?.condition ? cond('condition', b.condition) : a.condition;
    const handedOver = (validateDate('handedOverAt', b?.handedOverAt, { required: false }) ?? new Date()) as Date;
    const notes = validateText('notes', b?.notes, 500);
    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.assetAssignment.create({ data: { fellowship_id: a.fellowship_id!, asset_id: id, department_id: departmentId, responsible_member_id: responsible, from_location_id: a.location_id, to_location_id: toLocation ?? a.location_id, handed_over_at: handedOver, condition_at_handover: conditionAt, authorized_by: user.userId, notes, active_key: id } });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new ConflictException('This resource is already assigned; end that assignment first.');
        throw e;
      }
      await tx.asset.update({ where: { id }, data: { assigned_department_id: departmentId, status: 'assigned', ...(toLocation ? { location_id: toLocation } : {}), ...(responsible ? { custodian_member_id: responsible } : {}), condition: conditionAt } });
      await this.assets.history(tx, a, 'assigned', user.userId, { to_department_id: departmentId, from_location_id: a.location_id, to_location_id: toLocation ?? a.location_id, member_id: responsible, note: notes });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'resources.assign', entity_type: 'asset', entity_id: id, fellowship_id: a.fellowship_id, new_value: { departmentId } as any } });
    });
    await this.assets.notifyAll(await this.scope.departmentLeaderIds(departmentId), user.userId, a, 'resource_assigned', 'Resource assigned to your department', `${a.name} (${a.asset_tag}) has been assigned to your department. It remains fellowship property.`);
    return this.assets.detail(user, id);
  }

  async endAssignment(user: any, id: string, b: any) {
    const a = await this.scope.loadManaged(user, id);
    const open = await this.prisma.assetAssignment.findUnique({ where: { active_key: id } });
    if (!open) throw new ConflictException('This resource is not assigned.');
    const issued = await this.prisma.resourceRequest.count({ where: { asset_id: id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] } } });
    if (issued) throw new ConflictException('The resource is issued to a borrower; record the return first.');
    const conditionBack = b?.condition ? cond('condition', b.condition) : a.condition;
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.assetAssignment.updateMany({ where: { id: open.id, active_key: id }, data: { active_key: null, ended_at: new Date(), ended_by: user.userId, condition_at_return: conditionBack, end_notes: validateText('notes', b?.notes, 500) } });
      if (done.count !== 1) throw new ConflictException('This assignment has already ended.');
      await tx.asset.update({ where: { id }, data: { assigned_department_id: null, status: 'available', condition: conditionBack } });
      await this.assets.history(tx, a, 'assignment_ended', user.userId, { from_department_id: open.department_id, to_value: conditionBack });
    });
    return this.assets.detail(user, id);
  }

  // ===================== transfers =====================

  /**
   * kind 'location': a move (location and/or custodian) by whoever manages the resource - immediate.
   * kind 'ownership': a change of owner. A department's resource needs its Chairperson and the Treasurer; a
   * fellowship resource becoming a department's needs the Secretary and the Chairperson. Never silent.
   */
  async transfer(user: any, id: string, b: any) {
    const a = await this.scope.load(user, id);
    if (OUT_OF_SERVICE.includes(a.status) && a.status !== 'in_maintenance') throw new ConflictException('This resource is no longer in service.');
    const kind = b?.kind === 'ownership' ? 'ownership' : 'location';
    const reason = validateText('reason', b?.reason, 500, true) as string;
    const date = (validateDate('transferDate', b?.transferDate, { required: false }) ?? new Date()) as Date;
    const toLocation = validateOptionalUuid('toLocationId', b?.toLocationId);
    const toCustodian = validateOptionalUuid('toCustodianId', b?.toCustodianId);
    if (toLocation && !(await this.prisma.assetLocation.findFirst({ where: { id: toLocation, fellowship_id: a.fellowship_id, is_active: true } }))) throw new BadRequestException('The selected location is not available.');
    if (toCustodian && !(await this.prisma.member.findFirst({ where: { id: toCustodian, fellowship_id: a.fellowship_id } }))) throw new BadRequestException('The custodian must be a registered member.');
    const conditionBefore = b?.conditionBefore ? cond('conditionBefore', b.conditionBefore) : a.condition;

    if (kind === 'location') {
      // The manager moves it; a department holding an assigned fellowship asset may move it within its custody.
      const holder = a.assigned_department_id && (await this.scope.leaderships(user)).has(a.assigned_department_id);
      if (!(await this.scope.canManage(user, a)) && !holder) throw new ForbiddenException('You cannot move this resource.');
      if (!toLocation && !toCustodian) throw new BadRequestException('Choose the new location or custodian.');
      const t = await this.prisma.$transaction(async (tx) => {
        const row = await tx.assetTransfer.create({ data: {
          fellowship_id: a.fellowship_id!, transfer_number: await nextNumber(tx, a.fellowship_id!, 'asset_transfer', 'ATR', date), asset_id: id, kind,
          from_ownership: a.ownership_type, to_ownership: a.ownership_type, from_department_id: a.owning_department_id, to_department_id: a.owning_department_id,
          from_location_id: a.location_id, to_location_id: toLocation ?? a.location_id, from_custodian_id: a.custodian_member_id, to_custodian_id: toCustodian ?? a.custodian_member_id,
          transfer_date: date, reason, condition_before: conditionBefore, condition_after: b?.conditionAfter ? cond('conditionAfter', b.conditionAfter) : conditionBefore,
          status: 'COMPLETED', initiated_by: user.userId, approved_by: user.userId, completed_at: new Date(),
        } });
        await tx.asset.update({ where: { id }, data: { ...(toLocation ? { location_id: toLocation } : {}), ...(toCustodian ? { custodian_member_id: toCustodian } : {}), condition: row.condition_after ?? a.condition } });
        await this.assets.history(tx, a, 'transferred', user.userId, { from_location_id: a.location_id, to_location_id: toLocation ?? a.location_id, member_id: toCustodian, note: `${row.transfer_number}: ${reason}` });
        return row;
      });
      return t;
    }

    // ownership change
    const toOwnership = b?.toOwnership === 'fellowship' ? 'fellowship' : 'department';
    const toDept = toOwnership === 'department' ? validateRequiredUuid('toDepartmentId', b?.toDepartmentId) : null;
    if (toDept) await this.scope.department(user, toDept);
    if (a.ownership_type === 'borrowed') throw new BadRequestException('A borrowed resource belongs to someone else and cannot change owner.');
    if ((a.owning_department_id ?? null) === (toDept ?? null)) throw new BadRequestException('The resource already has that owner.');
    if (['borrowed', 'checked_out', 'reserved'].includes(a.status)) throw new ConflictException('The resource is out on loan; it can change owner once it is back.');
    const pending = await this.prisma.assetTransfer.findFirst({ where: { asset_id: id, kind: 'ownership', status: 'PENDING' } });
    if (pending) throw new ConflictException('An ownership transfer for this resource is already waiting for approval.');
    let workflow: string;
    let skipFirst = false;
    if (a.owning_department_id) {
      // Leaving a department's ownership: started by that department's leaders, authorized by its Chairperson.
      const role = (await this.scope.leaderships(user)).get(a.owning_department_id);
      if (!role) throw new ForbiddenException('Only the department that owns this resource can give it away.');
      workflow = 'asset_transfer_department';
      skipFirst = role === 'department_chairperson';
    } else {
      if (!this.scope.isTreasurer(user)) throw new ForbiddenException('Only the Treasurer can propose giving a fellowship resource to a department.');
      workflow = 'asset_transfer_fellowship';
    }
    const { transfer, approval } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetTransfer.create({ data: {
        fellowship_id: a.fellowship_id!, transfer_number: await nextNumber(tx, a.fellowship_id!, 'asset_transfer', 'ATR', date), asset_id: id, kind,
        from_ownership: a.ownership_type, to_ownership: toOwnership as any, from_department_id: a.owning_department_id, to_department_id: toDept,
        from_location_id: a.location_id, to_location_id: toLocation, from_custodian_id: a.custodian_member_id, to_custodian_id: toCustodian,
        transfer_date: date, reason, condition_before: conditionBefore, initiated_by: user.userId,
      } });
      const wf = await this.engine.createWorkflow(workflow, row.id, 'asset_transfer', user.userId, { departmentId: a.owning_department_id, assetId: id, reason }, a.fellowship_id, tx, { skipFirstStage: skipFirst });
      await tx.assetTransfer.update({ where: { id: row.id }, data: { approval_workflow_id: wf.id } });
      await this.assets.history(tx, a, 'updated', user.userId, { note: `Ownership transfer ${row.transfer_number} requested: ${reason}` });
      return { transfer: row, approval: await this.engine.submit(wf.id, tx, user.userId) };
    });
    await this.notify.stage(approval, 'resource ownership transfer', 'asset', id, user.userId);
    return transfer;
  }

  async listTransfers(user: any, q: any) {
    const where: any = { fellowship_id: this.scope.fellowship(user) };
    if (!this.scope.isCentralViewer(user)) {
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
      where.OR = [{ from_department_id: { in: led } }, { to_department_id: { in: led } }];
    }
    if (q?.status) where.status = String(q.status);
    return this.prisma.assetTransfer.findMany({ where, orderBy: { created_at: 'desc' }, take: 200 });
  }

  // ===================== requests: booking, handover, return =====================

  /** Overlapping holds on this resource in [from, until], excluding one request. */
  private async held(tx: any, assetId: string, from: Date, until: Date, exclude?: string) {
    const rows = await tx.resourceRequest.findMany({ where: { asset_id: assetId, status: { in: HOLDING }, needed_from: { lte: until }, needed_until: { gte: from }, ...(exclude ? { id: { not: exclude } } : {}) }, select: { quantity: true, quantity_returned: true } });
    return rows.reduce((s: number, r: any) => s + (r.quantity - r.quantity_returned), 0);
  }

  /** What is free to request: resources the caller may see, plus the fellowship's shareable resources (no costs). */
  async requestable(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const led = Array.from((await this.scope.leaderships(user)).keys());
    if (!this.scope.isCentralViewer(user) && !led.length) throw new ForbiddenException('You do not have permission to perform this action.');
    const where: any = { fellowship_id: fellowshipId, is_consumable: false, status: { notIn: ['disposed', 'lost', 'retired'] }, OR: [{ owning_department_id: null }, { owning_department_id: { in: led } }] };
    if (q?.search) where.name = { contains: validateText('search', q.search, 100), mode: 'insensitive' };
    const rows = await this.prisma.asset.findMany({ where, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true, asset_tag: true, quantity: true, status: true, owning_department_id: true, category: { select: { name: true } } } });
    return rows;
  }

  async createRequest(user: any, b: any) {
    const fellowshipId = this.scope.fellowship(user);
    const assetId = validateRequiredUuid('assetId', b?.assetId);
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, fellowship_id: fellowshipId } });
    if (!a) throw new NotFoundException('Resource not found');
    const departmentId = validateOptionalUuid('departmentId', b?.departmentId);
    const led = await this.scope.leaderships(user);
    if (departmentId && !led.has(departmentId)) throw new ForbiddenException('You can only request on behalf of a department you lead.');
    if (!departmentId && !this.scope.isCentralViewer(user)) throw new ForbiddenException('Choose the department you are requesting for.');
    // A department's private resource is requested only by that department; other departments ask the fellowship.
    if (a.owning_department_id && !led.has(a.owning_department_id)) throw new ForbiddenException('That resource belongs to another department.');
    if (a.is_consumable) throw new BadRequestException('Consumable stock is issued, not booked.');
    if (OUT_OF_SERVICE.includes(a.status)) throw new ConflictException(`The resource is ${a.status.replace('_', ' ')} and cannot be booked.`);
    const from = validateDate('neededFrom', b?.neededFrom, { maxFutureDays: 3650 }) as Date;
    const until = validateDate('neededUntil', b?.neededUntil, { maxFutureDays: 3650 }) as Date;
    if (until < from) throw new BadRequestException('neededUntil cannot be before neededFrom');
    const quantity = b?.quantity === undefined ? 1 : Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('quantity must be a whole number of at least 1');
    if (quantity > a.quantity) throw new BadRequestException(`Only ${a.quantity} of this resource exist.`);
    const purpose = validateText('purpose', b?.purpose, 500, true) as string;
    const activityId = validateOptionalUuid('activityId', b?.activityId);
    if (activityId && !(await this.prisma.activity.findFirst({ where: { id: activityId, fellowship_id: fellowshipId } }))) throw new BadRequestException('The selected activity is not available.');
    const projectId = validateOptionalUuid('projectId', b?.projectId);
    if (projectId && !(await this.prisma.project.findFirst({ where: { id: projectId, fellowship_id: fellowshipId } }))) throw new BadRequestException('The selected project is not available.');
    const borrower = validateOptionalUuid('borrowerMemberId', b?.borrowerMemberId);
    if (borrower && !(await this.prisma.member.findFirst({ where: { id: borrower, fellowship_id: fellowshipId } }))) throw new BadRequestException('The borrower must be a registered member.');
    const dup = await this.prisma.resourceRequest.findFirst({ where: { asset_id: assetId, requester_user_id: user.userId, status: { in: ['PENDING', 'APPROVED'] }, needed_from: { lte: until }, needed_until: { gte: from } } });
    if (dup) throw new ConflictException('You already have a request for this resource over these dates.');
    if ((await this.held(this.prisma, assetId, from, until)) + quantity > a.quantity) throw new ConflictException('The resource is already booked for some of those dates.');
    const r = await this.prisma.$transaction(async (tx) => tx.resourceRequest.create({ data: {
      fellowship_id: fellowshipId, request_number: await nextNumber(tx, fellowshipId, 'resource_request', 'RRQ', from), asset_id: assetId, requester_user_id: user.userId,
      department_id: departmentId, borrower_member_id: borrower, activity_id: activityId, project_id: projectId, quantity, purpose, needed_from: from, needed_until: until,
      location: validateText('location', b?.location, 200), supporting_info: validateText('supportingInfo', b?.supportingInfo, 1000),
    } }));
    await this.assets.notifyAll(await this.approverIds(a), user.userId, a, 'resource_request', 'New resource request', `${a.name} is requested for ${from.toISOString().slice(0, 10)}.`);
    return r;
  }

  /** Who decides: the Treasurer for fellowship resources; the owning department's Chairperson for its own. */
  private async approverIds(a: any) {
    return a.owning_department_id ? this.scope.departmentLeaderIds(a.owning_department_id, 'department_chairperson') : this.scope.usersWithRoles(a.fellowship_id, ['treasurer']);
  }
  private async canDecide(user: any, a: any) {
    if (!a.owning_department_id) return this.scope.isTreasurer(user);
    return (await this.scope.leaderships(user)).get(a.owning_department_id) === 'department_chairperson';
  }
  private async canHandle(user: any, a: any) {
    // Handover and return: whoever manages the resource (the Department Secretary handles their department's).
    return this.scope.canManage(user, a);
  }

  private async loadRequest(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Request not found');
    const r = await this.prisma.resourceRequest.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!r) throw new NotFoundException('Request not found');
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id: r.asset_id } });
    return { r, a };
  }

  async listRequests(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const where: any = { fellowship_id: fellowshipId };
    if (!this.scope.isCentralViewer(user)) {
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
      const owned = (await this.prisma.asset.findMany({ where: { fellowship_id: fellowshipId, owning_department_id: { in: led } }, select: { id: true } })).map((x) => x.id);
      where.OR = [{ department_id: { in: led } }, { asset_id: { in: owned } }, { requester_user_id: user.userId }];
    } else if (q?.departmentId && isUuid(q.departmentId)) where.department_id = q.departmentId;
    if (q?.status) where.status = String(q.status);
    if (q?.overdue === 'true') { where.status = { in: ['ISSUED', 'PARTIALLY_RETURNED'] }; where.needed_until = { lt: new Date() }; }
    if (q?.assetId && isUuid(q.assetId)) where.asset_id = q.assetId;
    const rows = await this.prisma.resourceRequest.findMany({ where, orderBy: { needed_from: 'desc' }, take: 300 });
    const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: rows.map((r) => r.asset_id) } }, select: { id: true, name: true, asset_tag: true, owning_department_id: true } })).map((a) => [a.id, a]));
    const depts = new Map((await this.prisma.department.findMany({ where: { id: { in: rows.map((r) => r.department_id).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const now = new Date();
    return Promise.all(rows.map(async (r) => {
      const a = assets.get(r.asset_id);
      return { ...r, asset: a, departmentName: r.department_id ? depts.get(r.department_id) : 'Fellowship', overdue: ['ISSUED', 'PARTIALLY_RETURNED'].includes(r.status) && r.needed_until < now, canDecide: r.status === 'PENDING' && r.requester_user_id !== user.userId && !!a && (await this.canDecide(user, a)), canHandle: !!a && (await this.canHandle(user, a)) };
    }));
  }

  async decide(user: any, id: string, b: any) {
    const { r, a } = await this.loadRequest(user, id);
    if (r.requester_user_id === user.userId) throw new ForbiddenException('You cannot decide on your own request.');
    if (!(await this.canDecide(user, a))) throw new ForbiddenException(a.owning_department_id ? 'Only the owning department\'s Chairperson approves its resources.' : 'Only the Treasurer approves requests for fellowship resources.');
    const decision = b?.decision;
    if (!['approved', 'rejected'].includes(decision)) throw new BadRequestException("decision must be 'approved' or 'rejected'");
    const note = validateText('comment', b?.comment, 500, decision === 'rejected');
    await this.prisma.$transaction(async (tx) => {
      // Lock the resource so two approvals for overlapping dates cannot both pass the availability check.
      await tx.$queryRaw`SELECT "id" FROM "assets" WHERE "id" = ${a.id}::uuid FOR UPDATE`;
      if (decision === 'approved') {
        const fresh = await tx.asset.findUniqueOrThrow({ where: { id: a.id } });
        if (OUT_OF_SERVICE.includes(fresh.status)) throw new ConflictException(`The resource is ${fresh.status.replace('_', ' ')}.`);
        if ((await this.held(tx, a.id, r.needed_from, r.needed_until, r.id)) + r.quantity > fresh.quantity) throw new ConflictException('The resource is already booked for some of those dates.');
      }
      const done = await tx.resourceRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision === 'approved' ? 'APPROVED' : 'REJECTED', decided_by: user.userId, decided_at: new Date(), decision_note: note } });
      if (done.count !== 1) throw new ConflictException('This request has already been decided.');
      if (decision === 'approved') await this.assets.history(tx, a, 'request_approved', user.userId, { note: `${r.request_number} for ${r.needed_from.toISOString().slice(0, 10)} – ${r.needed_until.toISOString().slice(0, 10)}` });
    });
    await this.assets.notifyAll([r.requester_user_id], user.userId, a, decision === 'approved' ? 'resource_request_approved' : 'resource_request_rejected', decision === 'approved' ? 'Resource request approved' : 'Resource request declined', `${r.request_number} (${a.name}) was ${decision}${note ? `: ${note}` : '.'}`);
    return this.loadRequest(user, id).then((x) => x.r);
  }

  async cancelRequest(user: any, id: string) {
    const { r, a } = await this.loadRequest(user, id);
    if (r.requester_user_id !== user.userId && !(await this.canDecide(user, a))) throw new ForbiddenException('Only the requester or the approver can cancel.');
    const done = await this.prisma.resourceRequest.updateMany({ where: { id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    if (done.count !== 1) throw new ConflictException('Only a pending or approved request can be cancelled.');
    return { id, status: 'CANCELLED' };
  }

  /** Handover. Only an approved request, and only while nothing else holds the resource. */
  async issue(user: any, id: string, b: any) {
    const { r, a } = await this.loadRequest(user, id);
    if (!(await this.canHandle(user, a))) throw new ForbiddenException('Only the resource\'s manager hands it over.');
    const out = b?.condition ? cond('condition', b.condition) : a.condition;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "assets" WHERE "id" = ${a.id}::uuid FOR UPDATE`;
      const others = await tx.resourceRequest.findMany({ where: { asset_id: a.id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] }, id: { not: id } }, select: { quantity: true, quantity_returned: true } });
      const outQty = others.reduce((s, o) => s + o.quantity - o.quantity_returned, 0);
      const fresh = await tx.asset.findUniqueOrThrow({ where: { id: a.id } });
      if (OUT_OF_SERVICE.includes(fresh.status) || fresh.status === 'checked_out') throw new ConflictException(`The resource is ${fresh.status.replace('_', ' ')}.`);
      if (outQty + r.quantity > fresh.quantity) throw new ConflictException('The resource is already out with someone else.');
      const done = await tx.resourceRequest.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'ISSUED', issued_at: new Date(), issued_by: user.userId, condition_out: out } });
      if (done.count !== 1) throw new ConflictException('Only an approved request can be handed over.');
      if (outQty + r.quantity >= fresh.quantity) await tx.asset.update({ where: { id: a.id }, data: { status: 'borrowed' } });
      await this.assets.history(tx, a, 'handed_over', user.userId, { member_id: r.borrower_member_id, to_department_id: r.department_id, to_value: out, note: r.request_number });
    });
    return this.loadRequest(user, id).then((x) => x.r);
  }

  /** Return (possibly partial). A damaged return opens a damage case automatically, with the evidence. */
  async returnItems(user: any, id: string, b: any) {
    const { r, a } = await this.loadRequest(user, id);
    if (!(await this.canHandle(user, a))) throw new ForbiddenException('Only the resource\'s manager receives returns.');
    if (!['ISSUED', 'PARTIALLY_RETURNED'].includes(r.status)) throw new ConflictException('Only an issued request can be returned.');
    const outstanding = r.quantity - r.quantity_returned;
    const qty = b?.quantity === undefined ? outstanding : Number(b.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > outstanding) throw new BadRequestException(`quantity must be between 1 and ${outstanding}`);
    const back = cond('condition', b?.condition ?? a.condition);
    const notes = validateText('notes', b?.notes, 500);
    const evidence = validateAttachments('evidence', b?.evidence ?? []);
    if (['damaged', 'poor'].includes(back) && !notes) throw new BadRequestException('Describe the damage.');
    const full = qty === outstanding;
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.resourceRequest.updateMany({ where: { id, status: r.status, quantity_returned: r.quantity_returned }, data: { quantity_returned: r.quantity_returned + qty, status: full ? 'RETURNED' : 'PARTIALLY_RETURNED', ...(full ? { returned_at: new Date(), received_by: user.userId } : {}), condition_in: back, return_notes: notes, return_evidence: evidence as any } });
      if (done.count !== 1) throw new ConflictException('This return was already recorded.');
      const stillOut = await tx.resourceRequest.count({ where: { asset_id: a.id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] } } });
      await tx.asset.update({ where: { id: a.id }, data: { condition: back, ...(stillOut ? {} : { status: await restingStatus(tx, a.id) }) } });
      await this.assets.history(tx, a, 'returned', user.userId, { member_id: r.borrower_member_id, from_department_id: r.department_id, from_value: r.condition_out, to_value: back, note: `${r.request_number}: ${qty} returned${notes ? ` - ${notes}` : ''}` });
      if (back === 'damaged') {
        await tx.assetIncident.create({ data: { fellowship_id: a.fellowship_id!, incident_number: await nextNumber(tx, a.fellowship_id!, 'asset_incident', 'INC'), asset_id: a.id, incident_type: 'damaged', description: notes ?? 'Returned damaged', occurred_at: new Date(), reported_by: user.userId, department_id: r.department_id, proposed_action: 'repair', attachments: evidence as any } });
        await this.assets.history(tx, a, 'incident_reported', user.userId, { note: `Returned damaged under ${r.request_number}` });
      }
    });
    if (back === 'damaged') await this.assets.notifyAll(await this.scope.managers(a), user.userId, a, 'resource_damaged', 'Resource returned damaged', `${a.name} (${a.asset_tag}) came back damaged.`);
    return this.loadRequest(user, id).then((x) => x.r);
  }

  /** An item lost while on loan: closes the loan and opens a loss case for the formal write-off decision. */
  async reportLostOnLoan(user: any, id: string, b: any) {
    const { r, a } = await this.loadRequest(user, id);
    if (!(await this.canHandle(user, a))) throw new ForbiddenException('Only the resource\'s manager records this.');
    if (!['ISSUED', 'PARTIALLY_RETURNED'].includes(r.status)) throw new ConflictException('Only an issued request can be reported lost.');
    const description = validateText('description', b?.description, 1000, true) as string;
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceRequest.update({ where: { id }, data: { status: 'RETURNED', returned_at: new Date(), received_by: user.userId, return_notes: `Reported lost: ${description}` } });
      await tx.assetIncident.create({ data: { fellowship_id: a.fellowship_id!, incident_number: await nextNumber(tx, a.fellowship_id!, 'asset_incident', 'INC'), asset_id: a.id, incident_type: 'lost', description, occurred_at: new Date(), reported_by: user.userId, department_id: r.department_id, proposed_action: 'write_off' } });
      await tx.asset.update({ where: { id: a.id }, data: { status: await restingStatus(tx, a.id) } });
      await this.assets.history(tx, a, 'incident_reported', user.userId, { note: `Lost while on loan (${r.request_number})` });
    });
    await this.assets.notifyAll(await this.scope.managers(a), user.userId, a, 'resource_lost', 'Resource reported lost', `${a.name} (${a.asset_tag}) was reported lost.`);
    return this.loadRequest(user, id).then((x) => x.r);
  }
}
