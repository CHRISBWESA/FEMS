import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateOptionalUuid, validateText } from '../shared/utils/validation.util';
import { VolunteersAccessService, ACTIVE_STATUSES, FILLED_STATUSES } from './volunteers-access.service';
import { parseDateTime, validateCapacity, validateEnum, validateShiftWindow } from './volunteer.validation';

const OPP_STATUSES = ['draft', 'open', 'closed', 'cancelled'] as const;
const TRANSITIONS: Record<string, string[]> = {
  draft: ['open', 'cancelled'],
  open: ['closed', 'cancelled'],
  closed: ['open', 'cancelled'],
  cancelled: [],
};

@Injectable()
export class VolunteerOpportunitiesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: VolunteersAccessService,
  ) {}

  // ---------- opportunities ----------

  async list(user: any, q: Record<string, string> = {}) {
    const mode = this.access.staffMode(user);
    const me = await this.access.myMember(user);
    const and: any[] = [];
    if (mode !== 'manager') {
      // Everyone sees open opportunities; department leaders also see their own department's drafts/closed
      // ones; a coordinator also sees the ones they coordinate.
      const or: any[] = [{ status: 'open' }];
      if (mode === 'department') or.push({ department_id: user.departmentId });
      if (me) or.push({ coordinator_member_id: me.id });
      and.push({ OR: or });
    }
    if (q.status) and.push({ status: validateEnum('status', q.status, OPP_STATUSES) });
    if (q.departmentId) and.push({ department_id: validateOptionalUuid('departmentId', q.departmentId) });
    const search = validateText('search', q.search, 100);
    if (search) and.push({ title: { contains: search, mode: 'insensitive' } });
    if (q.fellowshipId && !isUuid(q.fellowshipId)) throw new BadRequestException('fellowshipId must be a valid id');
    const where = this.tenantScope.scopeWhere(user, and.length ? { AND: and } : {}, q.fellowshipId);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);

    const [rows, total] = await Promise.all([
      this.prisma.serviceOpportunity.findMany({
        where, orderBy: [{ created_at: 'desc' }], take, skip,
        include: { department: { select: { id: true, name: true } }, coordinator: { select: { id: true, full_name: true } } },
      }),
      this.prisma.serviceOpportunity.count({ where }),
    ]);

    // Upcoming-shift summary for the page (two aggregate queries, not one per row).
    const ids = rows.map((r) => r.id);
    const shifts = ids.length ? await this.prisma.serviceShift.findMany({
      where: { opportunity_id: { in: ids }, status: 'scheduled', starts_at: { gt: new Date() } },
      select: { id: true, opportunity_id: true, starts_at: true, capacity: true },
    }) : [];
    const filled = shifts.length ? await this.prisma.serviceAssignment.groupBy({
      by: ['shift_id'], where: { shift_id: { in: shifts.map((s) => s.id) }, status: { in: [...FILLED_STATUSES] } }, _count: { _all: true },
    }) : [];
    const filledBy = new Map(filled.map((f) => [f.shift_id, f._count._all]));
    const data = rows.map((r) => {
      const mine = shifts.filter((s) => s.opportunity_id === r.id);
      const spotsLeft = mine.reduce((n, s) => n + Math.max(0, s.capacity - (filledBy.get(s.id) ?? 0)), 0);
      const next = mine.reduce<Date | null>((min, s) => (!min || s.starts_at < min ? s.starts_at : min), null);
      return { ...r, upcomingShifts: mine.length, spotsLeft, nextShiftAt: next };
    });
    return { data, total };
  }

  async get(id: string, user: any) {
    const opp = await this.access.loadOpportunity(id, user);
    // Drafts/closed/cancelled opportunities do not exist as far as non-staff are concerned.
    if (!(await this.access.canView(user, opp))) throw new NotFoundException('Opportunity not found');
    const staff = await this.access.canCoordinate(user, opp);
    const me = await this.access.myMember(user);
    const shiftWhere: any = { opportunity_id: id };
    if (!staff) { shiftWhere.status = 'scheduled'; shiftWhere.starts_at = { gt: new Date() }; }
    const shifts = await this.prisma.serviceShift.findMany({
      where: shiftWhere, orderBy: { starts_at: 'asc' }, take: 200,
      include: { role: { select: { id: true, name: true } } },
    });
    const [department, coordinator] = await Promise.all([
      opp.department_id ? this.prisma.department.findUnique({ where: { id: opp.department_id }, select: { id: true, name: true } }) : null,
      opp.coordinator_member_id ? this.prisma.member.findUnique({ where: { id: opp.coordinator_member_id }, select: { id: true, full_name: true } }) : null,
    ]);
    return { ...opp, department, coordinator, canCoordinate: staff, canManage: this.canManageSync(user, opp), shifts: await this.decorateShifts(shifts, me, staff) };
  }

  private canManageSync(user: any, opp: any): boolean {
    const mode = this.access.staffMode(user);
    return mode === 'manager' || (mode === 'department' && !!opp.department_id && opp.department_id === user.departmentId);
  }

  async create(dto: any, user: any) {
    const mode = this.access.staffMode(user);
    if (!mode) throw new ForbiddenException('You do not have permission to perform this action.');
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const title = validateText('title', dto?.title, 150, true) as string;
    const description = validateText('description', dto?.description, 2000);
    const location = validateText('location', dto?.location, 200);
    const status = dto?.status === undefined ? 'draft' : validateEnum('status', dto.status, ['draft', 'open'] as const);

    let departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    if (mode === 'department') {
      if (departmentId && departmentId !== user.departmentId) throw new ForbiddenException('You can only create opportunities for your own department.');
      departmentId = user.departmentId;
    }
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    const coordinatorId = validateOptionalUuid('coordinatorMemberId', dto?.coordinatorMemberId);
    if (coordinatorId) await this.access.assertMember(coordinatorId, fellowshipId);

    const created = await this.prisma.serviceOpportunity.create({
      data: { fellowship_id: fellowshipId, department_id: departmentId, title, description, location, coordinator_member_id: coordinatorId, status, created_by: user.userId },
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.opportunity_create', entityType: 'service_opportunity', entityId: created.id, newValue: { title, status, departmentId, coordinatorId } });
    return created;
  }

  async update(id: string, dto: any, user: any) {
    const opp = await this.access.loadOpportunity(id, user);
    this.access.assertCanManage(user, opp);
    if (opp.status === 'cancelled') throw new ConflictException('A cancelled opportunity cannot be edited.');
    const data: Record<string, any> = {};
    if (dto?.title !== undefined) data.title = validateText('title', dto.title, 150, true);
    if (dto?.description !== undefined) data.description = validateText('description', dto.description, 2000);
    if (dto?.location !== undefined) data.location = validateText('location', dto.location, 200);
    if (dto?.coordinatorMemberId !== undefined) {
      const c = validateOptionalUuid('coordinatorMemberId', dto.coordinatorMemberId);
      if (c) await this.access.assertMember(c, opp.fellowship_id);
      data.coordinator_member_id = c;
    }
    if (dto?.departmentId !== undefined) {
      if (this.access.staffMode(user) !== 'manager') throw new ForbiddenException('Only a volunteer manager can move an opportunity to another department.');
      const d = validateOptionalUuid('departmentId', dto.departmentId);
      if (d) await this.access.assertDepartment(d, opp.fellowship_id);
      data.department_id = d;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');
    const updated = await this.prisma.serviceOpportunity.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.opportunity_update', entityType: 'service_opportunity', entityId: id, newValue: { fields: Object.keys(data) } });
    return updated;
  }

  async setStatus(id: string, dto: any, user: any) {
    const opp = await this.access.loadOpportunity(id, user);
    this.access.assertCanManage(user, opp);
    const target = validateEnum('status', dto?.status, OPP_STATUSES);
    if (!TRANSITIONS[opp.status].includes(target)) throw new ConflictException(`An opportunity that is ${opp.status} cannot become ${target}.`);

    const notify: { userId: string; shiftId: string }[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.serviceOpportunity.updateMany({ where: { id, status: opp.status }, data: { status: target } });
      if (flip.count !== 1) throw new ConflictException('The opportunity changed while you were editing it. Reload and try again.');
      if (target === 'cancelled') {
        const shifts = await tx.serviceShift.findMany({ where: { opportunity_id: id, status: 'scheduled' }, select: { id: true } });
        await tx.serviceShift.updateMany({ where: { opportunity_id: id, status: 'scheduled' }, data: { status: 'cancelled' } });
        notify.push(...(await this.cancelActiveAssignments(tx, shifts.map((s) => s.id), user.userId)));
      }
      return tx.serviceOpportunity.findUnique({ where: { id } });
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.opportunity_status', entityType: 'service_opportunity', entityId: id, oldValue: { status: opp.status }, newValue: { status: target, assignmentsCancelled: notify.length } });
    for (const n of notify) {
      await this.access.notify(n.userId, 'volunteer_update', 'Service cancelled', 'A service opportunity you signed up for has been cancelled.', n.shiftId, opp.fellowship_id);
    }
    return updated;
  }

  // ---------- shifts ----------

  async createShift(opportunityId: string, dto: any, user: any) {
    const opp = await this.access.loadOpportunity(opportunityId, user);
    await this.access.assertCanCoordinate(user, opp);
    if (opp.status === 'cancelled') throw new ConflictException('This opportunity is cancelled.');

    const startsAt = parseDateTime('startsAt', dto?.startsAt);
    const endsAt = parseDateTime('endsAt', dto?.endsAt);
    validateShiftWindow(startsAt, endsAt);
    const capacity = validateCapacity(dto?.capacity, 1);
    const location = validateText('location', dto?.location, 200);
    const notes = validateText('notes', dto?.notes, 500);
    const roleId = validateOptionalUuid('roleId', dto?.roleId);
    if (roleId) {
      const role = await this.prisma.serviceRole.findFirst({ where: { id: roleId, fellowship_id: opp.fellowship_id, is_active: true }, select: { id: true } });
      if (!role) throw new BadRequestException('The selected role is not available.');
    }
    const activityId = validateOptionalUuid('activityId', dto?.activityId);
    if (activityId) {
      const act = await this.prisma.activity.findFirst({ where: { id: activityId, fellowship_id: opp.fellowship_id }, select: { id: true } });
      if (!act) throw new BadRequestException('The selected activity is not available.');
    }
    const shift = await this.prisma.serviceShift.create({
      data: { fellowship_id: opp.fellowship_id, opportunity_id: opportunityId, role_id: roleId, starts_at: startsAt, ends_at: endsAt, location, capacity, activity_id: activityId, notes, created_by: user.userId },
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.shift_create', entityType: 'service_shift', entityId: shift.id, newValue: { opportunityId, startsAt, endsAt, capacity } });
    return shift;
  }

  async updateShift(id: string, dto: any, user: any) {
    const { shift, opp } = await this.access.loadShift(id, user);
    await this.access.assertCanCoordinate(user, opp);

    const data: Record<string, any> = {};
    const timesChange = dto?.startsAt !== undefined || dto?.endsAt !== undefined;
    let newStart = shift.starts_at as Date;
    let newEnd = shift.ends_at as Date;
    if (timesChange) {
      newStart = dto?.startsAt !== undefined ? parseDateTime('startsAt', dto.startsAt) : newStart;
      newEnd = dto?.endsAt !== undefined ? parseDateTime('endsAt', dto.endsAt) : newEnd;
      validateShiftWindow(newStart, newEnd);
      data.starts_at = newStart;
      data.ends_at = newEnd;
    }
    if (dto?.capacity !== undefined) data.capacity = validateCapacity(dto.capacity);
    if (dto?.location !== undefined) data.location = validateText('location', dto.location, 200);
    if (dto?.notes !== undefined) data.notes = validateText('notes', dto.notes, 500);
    if (dto?.roleId !== undefined) {
      const roleId = validateOptionalUuid('roleId', dto.roleId);
      if (roleId) {
        const role = await this.prisma.serviceRole.findFirst({ where: { id: roleId, fellowship_id: shift.fellowship_id, is_active: true }, select: { id: true } });
        if (!role) throw new BadRequestException('The selected role is not available.');
      }
      data.role_id = roleId;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.$transaction(async (tx) => {
      // The row lock makes the checks below race-free against concurrent sign-ups/approvals.
      const locked = await this.access.lockShift(tx, id);
      if (locked.status !== 'scheduled') throw new ConflictException('Only a scheduled shift can be edited.');
      if (new Date(locked.starts_at).getTime() <= Date.now()) throw new ConflictException('A shift that has started can no longer be edited.');
      if (timesChange) {
        const active = await tx.serviceAssignment.count({ where: { shift_id: id, status: { in: [...ACTIVE_STATUSES, 'attended'] } } });
        if (active > 0) throw new ConflictException('This shift already has volunteers. Cancel it and create a new one to change the time.');
      }
      if (data.capacity !== undefined) {
        const filled = await tx.serviceAssignment.count({ where: { shift_id: id, status: { in: [...FILLED_STATUSES] } } });
        if (data.capacity < filled) throw new ConflictException(`Capacity cannot be lower than the ${filled} volunteer(s) already confirmed.`);
      }
      return tx.serviceShift.update({ where: { id }, data });
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.shift_update', entityType: 'service_shift', entityId: id, newValue: { fields: Object.keys(data) } });
    return updated;
  }

  async cancelShift(id: string, user: any) {
    const { shift, opp } = await this.access.loadShift(id, user);
    await this.access.assertCanCoordinate(user, opp);
    const notify = await this.prisma.$transaction(async (tx) => {
      await this.access.lockShift(tx, id);
      const flip = await tx.serviceShift.updateMany({ where: { id, status: 'scheduled', starts_at: { gt: new Date() } }, data: { status: 'cancelled' } });
      if (flip.count !== 1) throw new ConflictException('Only a scheduled shift that has not started can be cancelled.');
      return this.cancelActiveAssignments(tx, [id], user.userId);
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.shift_cancel', entityType: 'service_shift', entityId: id, newValue: { assignmentsCancelled: notify.length } });
    for (const n of notify) {
      await this.access.notify(n.userId, 'volunteer_update', 'Service cancelled', 'A service shift you signed up for has been cancelled.', n.shiftId, shift.fellowship_id);
    }
    return { cancelled: true, assignmentsCancelled: notify.length };
  }

  // Cancels every applied/confirmed assignment on the shifts; returns whom to notify (members with accounts).
  private async cancelActiveAssignments(tx: any, shiftIds: string[], actorId: string): Promise<{ userId: string; shiftId: string }[]> {
    if (!shiftIds.length) return [];
    const rows = await tx.serviceAssignment.findMany({
      where: { shift_id: { in: shiftIds }, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, shift_id: true, member: { select: { user_id: true } } },
    });
    if (!rows.length) return [];
    await tx.serviceAssignment.updateMany({
      where: { id: { in: rows.map((r: any) => r.id) }, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'cancelled', decided_by: actorId, decided_at: new Date() },
    });
    return rows.filter((r: any) => r.member?.user_id).map((r: any) => ({ userId: r.member.user_id, shiftId: r.shift_id }));
  }

  // Adds filled/spots-left counts, the caller's own assignment, and (for staff) the pending-application count.
  async decorateShifts(shifts: any[], me: { id: string } | null, staff: boolean) {
    const ids = shifts.map((s) => s.id);
    const grouped = ids.length ? await this.prisma.serviceAssignment.groupBy({ by: ['shift_id', 'status'], where: { shift_id: { in: ids } }, _count: { _all: true } }) : [];
    const mine = me && ids.length ? await this.prisma.serviceAssignment.findMany({ where: { shift_id: { in: ids }, member_id: me.id }, select: { id: true, shift_id: true, status: true } }) : [];
    const count = (shiftId: string, statuses: readonly string[]) => grouped.filter((g) => g.shift_id === shiftId && statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    return shifts.map((s) => {
      const filled = count(s.id, FILLED_STATUSES);
      const my = mine.find((m) => m.shift_id === s.id);
      return {
        ...s,
        filled,
        spotsLeft: Math.max(0, s.capacity - filled),
        myAssignment: my ? { id: my.id, status: my.status } : null,
        ...(staff ? { pendingApplications: count(s.id, ['applied']) } : {}),
      };
    });
  }
}
