import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { validateRequiredUuid, validateText } from '../shared/utils/validation.util';
import { VolunteersAccessService, ACTIVE_STATUSES, FILLED_STATUSES } from './volunteers-access.service';
import { validateEnum } from './volunteer.validation';

const NEUTRAL = {
  assigned: ['You have been assigned', 'You have been assigned to a service shift.'],
  approved: ['Application approved', 'Your volunteer application has been approved.'],
  rejected: ['Application update', 'Your volunteer application was not accepted.'],
  cancelled: ['Assignment cancelled', 'One of your service assignments has been cancelled.'],
  applied: ['New volunteer application', 'A new volunteer application is waiting for your decision.'],
  withdrawn: ['Volunteer withdrew', 'A volunteer has withdrawn from a shift you coordinate.'],
} as const;

@Injectable()
export class VolunteerAssignmentsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private access: VolunteersAccessService,
  ) {}

  // Name + status only. No phone/e-mail/profile data is ever returned by the volunteering endpoints.
  async roster(shiftId: string, user: any) {
    const { shift, opp } = await this.access.loadShift(shiftId, user);
    await this.access.assertCanCoordinate(user, opp);
    return this.prisma.serviceAssignment.findMany({
      where: { shift_id: shift.id },
      orderBy: [{ created_at: 'asc' }],
      take: 500,
      select: { id: true, status: true, note: true, decided_at: true, created_at: true, member: { select: { id: true, full_name: true } } },
    });
  }

  // ---------- member self-service ----------

  async apply(shiftId: string, dto: any, user: any) {
    const me = await this.access.requireMyMember(user);
    const { shift, opp } = await this.access.loadShift(shiftId, user);
    if (me.fellowship_id !== shift.fellowship_id) throw new NotFoundException('Shift not found');
    if (!(await this.access.canView(user, opp))) throw new NotFoundException('Shift not found');
    if (opp.status !== 'open') throw new ConflictException('This opportunity is not accepting applications.');
    const note = validateText('note', dto?.note, 300);

    const created = await this.prisma.$transaction(async (tx) => {
      const locked = await this.access.lockShift(tx, shiftId);
      this.assertBookable(locked);
      await this.access.lockMember(tx, me.id);
      const existing = await tx.serviceAssignment.findUnique({ where: { shift_id_member_id: { shift_id: shiftId, member_id: me.id } } });
      if (existing && existing.status !== 'withdrawn') throw new ConflictException(`You already have an assignment for this shift (${existing.status.replace('_', ' ')}).`);
      await this.assertNoConflict(tx, locked, me.id);
      if (existing) {
        const flip = await tx.serviceAssignment.updateMany({ where: { id: existing.id, status: 'withdrawn' }, data: { status: 'applied', note, decided_by: null, decided_at: null } });
        if (flip.count !== 1) throw new ConflictException('Your assignment changed. Reload and try again.');
        return tx.serviceAssignment.findUnique({ where: { id: existing.id } });
      }
      return tx.serviceAssignment.create({ data: { fellowship_id: shift.fellowship_id, shift_id: shiftId, member_id: me.id, status: 'applied', note, created_by: user.userId } });
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.apply', entityType: 'service_shift', entityId: shiftId, newValue: { assignmentId: created!.id } });
    await this.notifyCoordinator(opp, NEUTRAL.applied, shiftId);
    return created;
  }

  async withdraw(assignmentId: string, user: any) {
    const { assignment, shift, opp } = await this.access.loadAssignment(assignmentId, user);
    const me = await this.access.myMember(user);
    // Somebody else's assignment is indistinguishable from a missing one.
    if (!me || me.id !== assignment.member_id) throw new NotFoundException('Assignment not found');
    const flip = await this.prisma.serviceAssignment.updateMany({
      where: { id: assignmentId, status: { in: [...ACTIVE_STATUSES] }, shift: { starts_at: { gt: new Date() } } },
      data: { status: 'withdrawn', decided_at: new Date() },
    });
    if (flip.count !== 1) throw new ConflictException('This assignment can no longer be withdrawn (it may already have started, or been decided).');
    await this.auditService.log({ userId: user.userId, action: 'volunteer.withdraw', entityType: 'service_assignment', entityId: assignmentId, oldValue: { status: assignment.status } });
    if (assignment.status === 'confirmed') await this.notifyCoordinator(opp, NEUTRAL.withdrawn, shift.id);
    return { withdrawn: true };
  }

  // ---------- coordinators / managers ----------

  // Direct placement by a manager or the owning department's leader. A department leader can only place members of
  // their own department; a coordinator who is neither handles applications (decide) instead, so nobody can use
  // this endpoint to look members up by id.
  async assign(shiftId: string, dto: any, user: any) {
    const mode = this.access.staffMode(user);
    if (!mode) throw new ForbiddenException('You do not have permission to perform this action.');
    const { shift, opp } = await this.access.loadShift(shiftId, user);
    await this.access.assertCanCoordinate(user, opp);
    if (opp.status === 'cancelled') throw new ConflictException('This opportunity is cancelled.');
    const memberId = validateRequiredUuid('memberId', dto?.memberId);
    const note = validateText('note', dto?.note, 300);
    const member = await this.access.assertMember(memberId, shift.fellowship_id);
    if (mode === 'department') {
      const inDept = await this.prisma.departmentMember.findFirst({ where: { member_id: memberId, department_id: user.departmentId, removed: false }, select: { id: true } });
      if (!inDept) throw new ForbiddenException('You can only assign members of your own department.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await this.access.lockShift(tx, shiftId);
      this.assertBookable(locked);
      await this.access.lockMember(tx, memberId);
      const existing = await tx.serviceAssignment.findUnique({ where: { shift_id_member_id: { shift_id: shiftId, member_id: memberId } } });
      if (existing && !['applied', 'withdrawn', 'cancelled', 'rejected'].includes(existing.status)) {
        throw new ConflictException(`This member already has this shift (${existing.status.replace('_', ' ')}).`);
      }
      await this.confirmSlot(tx, locked, memberId);
      const now = new Date();
      if (existing) {
        const flip = await tx.serviceAssignment.updateMany({ where: { id: existing.id, status: existing.status }, data: { status: 'confirmed', note, decided_by: user.userId, decided_at: now } });
        if (flip.count !== 1) throw new ConflictException('The assignment changed. Reload and try again.');
        return tx.serviceAssignment.findUnique({ where: { id: existing.id } });
      }
      return tx.serviceAssignment.create({ data: { fellowship_id: shift.fellowship_id, shift_id: shiftId, member_id: memberId, status: 'confirmed', note, decided_by: user.userId, decided_at: now, created_by: user.userId } });
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.assign', entityType: 'service_shift', entityId: shiftId, newValue: { assignmentId: result!.id, memberId } });
    await this.access.notify(member.user_id, 'volunteer_update', NEUTRAL.assigned[0], NEUTRAL.assigned[1], shiftId, shift.fellowship_id);
    return result;
  }

  async decide(assignmentId: string, dto: any, user: any) {
    const { assignment, shift, opp } = await this.access.loadAssignment(assignmentId, user);
    await this.access.assertCanCoordinate(user, opp);
    const decision = validateEnum('decision', dto?.decision, ['approve', 'reject'] as const);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await this.access.lockShift(tx, shift.id);
      await this.access.lockMember(tx, assignment.member_id);
      if (decision === 'approve') {
        this.assertBookable(locked);
        await this.confirmSlot(tx, locked, assignment.member_id);
      }
      const flip = await tx.serviceAssignment.updateMany({
        where: { id: assignmentId, status: 'applied' },
        data: { status: decision === 'approve' ? 'confirmed' : 'rejected', decided_by: user.userId, decided_at: now },
      });
      if (flip.count !== 1) throw new ConflictException('This application has already been decided.');
      return tx.serviceAssignment.findUnique({ where: { id: assignmentId } });
    });
    await this.auditService.log({ userId: user.userId, action: `volunteer.${decision}`, entityType: 'service_assignment', entityId: assignmentId, newValue: { shiftId: shift.id } });
    const text = decision === 'approve' ? NEUTRAL.approved : NEUTRAL.rejected;
    await this.access.notify(assignment.member.user_id, 'volunteer_update', text[0], text[1], shift.id, shift.fellowship_id);
    return updated;
  }

  async cancel(assignmentId: string, user: any) {
    const { assignment, shift, opp } = await this.access.loadAssignment(assignmentId, user);
    await this.access.assertCanCoordinate(user, opp);
    const flip = await this.prisma.serviceAssignment.updateMany({
      where: { id: assignmentId, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'cancelled', decided_by: user.userId, decided_at: new Date() },
    });
    if (flip.count !== 1) throw new ConflictException('Only an applied or confirmed assignment can be cancelled.');
    await this.auditService.log({ userId: user.userId, action: 'volunteer.cancel_assignment', entityType: 'service_assignment', entityId: assignmentId, oldValue: { status: assignment.status } });
    await this.access.notify(assignment.member.user_id, 'volunteer_update', NEUTRAL.cancelled[0], NEUTRAL.cancelled[1], shift.id, shift.fellowship_id);
    return { cancelled: true };
  }

  // Service attendance. Only a confirmed volunteer of a shift that has started can be marked; a "no show" can
  // later be corrected to "attended", but "attended" is final. When the shift is linked to an Activity, the
  // volunteer also gets a normal member-linked Attendance row (once) so engagement figures stay consistent.
  async markAttendance(assignmentId: string, dto: any, user: any) {
    const { assignment, shift, opp } = await this.access.loadAssignment(assignmentId, user);
    await this.access.assertCanCoordinate(user, opp);
    const outcome = validateEnum('outcome', dto?.outcome, ['attended', 'no_show'] as const);
    const from = outcome === 'attended' ? ['confirmed', 'no_show'] : ['confirmed'];

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.serviceAssignment.updateMany({
        where: { id: assignmentId, status: { in: from as any }, shift: { starts_at: { lte: new Date() }, status: 'scheduled' } },
        data: { status: outcome, decided_by: user.userId, decided_at: new Date() },
      });
      if (flip.count !== 1) throw new ConflictException('Attendance can only be recorded for a confirmed volunteer once the shift has started.');
      if (outcome === 'attended' && shift.activity_id) {
        const exists = await tx.attendance.findFirst({ where: { activity_id: shift.activity_id, member_id: assignment.member_id }, select: { id: true } });
        if (!exists) {
          await tx.attendance.create({ data: { activity_id: shift.activity_id, member_id: assignment.member_id, recorded_by_name: assignment.member.full_name, is_confirmed: true, fellowship_id: shift.fellowship_id } });
        }
      }
    });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.attendance', entityType: 'service_assignment', entityId: assignmentId, oldValue: { status: assignment.status }, newValue: { status: outcome } });
    return { status: outcome };
  }

  // ---------- skills-based suggestions ----------

  // Skills live in the member profile (member.profile_view), so this needs that permission on top of being a
  // manager / owning-department leader. Department leaders only see members of their own department.
  async suggestions(shiftId: string, user: any) {
    this.access.requirePermission(user, PERMISSIONS.MEMBER_PROFILE_VIEW);
    const mode = this.access.staffMode(user);
    if (!mode) throw new ForbiddenException('You do not have permission to perform this action.');
    const { shift, opp } = await this.access.loadShift(shiftId, user);
    await this.access.assertCanCoordinate(user, opp);
    const role = shift.role_id ? await this.prisma.serviceRole.findUnique({ where: { id: shift.role_id }, select: { name: true, required_skills: true } }) : null;
    const skills: string[] = role?.required_skills ?? [];
    if (!skills.length) return { role: role?.name ?? null, skills, candidates: [] };

    const profiles = await this.prisma.memberProfile.findMany({
      where: {
        fellowship_id: shift.fellowship_id,
        OR: [{ skills: { hasSome: skills } }, { service_interests: { hasSome: skills } }],
        member: {
          membership_status: 'active',
          ...(mode === 'department' ? { departmentMemberships: { some: { department_id: user.departmentId, removed: false } } } : {}),
        },
      },
      take: 100,
      select: { member_id: true, skills: true, service_interests: true, member: { select: { full_name: true } } },
    });
    const ids = profiles.map((p) => p.member_id);
    const [taken, busy] = ids.length ? await Promise.all([
      this.prisma.serviceAssignment.findMany({ where: { shift_id: shiftId, member_id: { in: ids }, status: { in: [...ACTIVE_STATUSES, 'attended'] } }, select: { member_id: true } }),
      this.prisma.serviceAssignment.findMany({
        where: { member_id: { in: ids }, status: { in: [...FILLED_STATUSES] }, shift_id: { not: shiftId }, shift: { status: 'scheduled', starts_at: { lt: shift.ends_at }, ends_at: { gt: shift.starts_at } } },
        select: { member_id: true },
      }),
    ]) : [[], []];
    const exclude = new Set([...taken, ...busy].map((r) => r.member_id));
    const candidates = profiles
      .filter((p) => !exclude.has(p.member_id))
      .map((p) => ({ memberId: p.member_id, fullName: p.member.full_name, matched: skills.filter((s) => p.skills.includes(s) || p.service_interests.includes(s)) }))
      .sort((a, b) => b.matched.length - a.matched.length)
      .slice(0, 20);
    return { role: role?.name ?? null, skills, candidates };
  }

  // ---------- helpers ----------

  // A shift can be booked only while it is scheduled and has not started (state read under the row lock).
  private assertBookable(locked: any): void {
    if (locked.status !== 'scheduled') throw new ConflictException('This shift is not open for assignments.');
    if (new Date(locked.starts_at).getTime() <= Date.now()) throw new ConflictException('This shift has already started.');
  }

  // Capacity and time-conflict checks; call only while holding the shift and member row locks.
  private async confirmSlot(tx: any, locked: any, memberId: string): Promise<void> {
    const filled = await tx.serviceAssignment.count({ where: { shift_id: locked.id, status: { in: [...FILLED_STATUSES] } } });
    if (filled >= locked.capacity) throw new ConflictException('This shift is already full.');
    await this.assertNoConflict(tx, locked, memberId);
  }

  // The member may not hold a confirmed/attended assignment on another scheduled shift that overlaps this one.
  private async assertNoConflict(tx: any, locked: any, memberId: string): Promise<void> {
    const clash = await tx.serviceAssignment.findFirst({
      where: {
        member_id: memberId,
        status: { in: [...FILLED_STATUSES] },
        shift_id: { not: locked.id },
        shift: { status: 'scheduled', starts_at: { lt: locked.ends_at }, ends_at: { gt: locked.starts_at } },
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('This volunteer already has a conflicting service assignment at that time.');
  }

  private async notifyCoordinator(opp: any, text: readonly [string, string], shiftId: string): Promise<void> {
    if (!opp.coordinator_member_id) return;
    const c = await this.prisma.member.findUnique({ where: { id: opp.coordinator_member_id }, select: { user_id: true } });
    await this.access.notify(c?.user_id, 'volunteer_update', text[0], text[1], shiftId, opp.fellowship_id);
  }
}
