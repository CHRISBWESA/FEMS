import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAttachments } from '../department-workspace/department.util';
import { DepartmentLeadershipService } from '../department-workspace/department-leadership.service';
import { MemberGroupsService } from '../members/member-groups.service';
import { Report, ReportColumn } from '../finance/accounting/exporters';

const VIEWERS = ['fellowship_admin', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer'];
const LEVELS = ['fellowship', 'department', 'group'];
const END_REASONS = ['replaced', 'resigned', 'term_completed', 'removed', 'other'];
const FELLOWSHIP_ROLES = ['chairperson', 'assistant_chairperson', 'secretary', 'assistant_secretary', 'treasurer'];
const DAY = 86_400_000;

type Tx = Prisma.TransactionClient;
const text = (field: string, v: unknown, max: number, required = false): string | null => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new BadRequestException(`${field} must be text`);
  if (v.trim().length > max) throw new BadRequestException(`${field} must be at most ${max} characters`);
  return v.trim();
};
const date = (field: string, v: unknown, required = false): Date | null => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime()) || d < new Date('1990-01-01')) throw new BadRequestException(`${field} must be a valid date`);
  return d;
};

/**
 * Leadership management: the central record of appointments.
 *
 * Writes go THROUGH the module that makes an office take effect (account roles, department_leaders, the group
 * leader flag), so access, dashboards and approval routing all follow at once. Offices changed in other FEMS screens
 * are reconciled back here before every read, so the directory never disagrees with the rest of FEMS. Appointments
 * are never deleted.
 */
@Injectable()
export class LeadershipService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationEngineService,
    private departments: DepartmentLeadershipService,
    private groups: MemberGroupsService,
  ) {}

  // ===================== access =====================

  private roles(user: any): string[] { return (user?.roles as string[]) || []; }
  private has(user: any, ...r: string[]) { return r.some((x) => this.roles(user).includes(x)); }
  private perm(user: any, p: string) { return ((user?.permissions as string[]) || []).includes(p); }

  private fellowship(user: any): string {
    if (!user?.fellowshipId) throw new ForbiddenException('You do not have permission to perform this action.');
    return user.fellowshipId;
  }

  private requireViewer(user: any): string {
    const f = this.fellowship(user);
    if (!this.has(user, ...VIEWERS)) throw new ForbiddenException('You do not have access to leadership records.');
    return f;
  }

  /** Who may appoint to / end an office of this position. Checked on the server for every change. */
  private requireManager(user: any, position: any) {
    if (position.is_system) {
      if (position.level === 'fellowship' && !this.perm(user, PERMISSIONS.USER_ROLE_ASSIGN_GOV)) {
        throw new ForbiddenException('Only the Fellowship Administrator appoints the fellowship\'s officers.');
      }
      if (position.level === 'department' && !this.has(user, 'secretary', 'assistant_secretary')) {
        throw new ForbiddenException('Only the Fellowship Secretary appoints department leaders.');
      }
      if (position.level === 'group' && !this.perm(user, PERMISSIONS.MEMBER_GROUPS_MANAGE)) {
        throw new ForbiddenException('Only the Fellowship Secretary appoints group leaders.');
      }
      return;
    }
    const ok = position.level === 'fellowship' ? this.has(user, 'fellowship_admin', 'secretary') : this.has(user, 'secretary', 'assistant_secretary');
    if (!ok) throw new ForbiddenException('You cannot manage appointments to this position.');
  }

  private canConfigure(user: any) { return this.has(user, 'fellowship_admin', 'secretary'); }

  // ===================== positions =====================

  async positions(user: any) {
    const f = this.requireViewer(user);
    return this.prisma.leadershipPosition.findMany({ where: { OR: [{ fellowship_id: null }, { fellowship_id: f }] }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] });
  }

  async createPosition(user: any, b: any) {
    const f = this.fellowship(user);
    if (!this.canConfigure(user)) throw new ForbiddenException('Only the Fellowship Administrator or Secretary configures positions.');
    const name = text('name', b?.name, 100, true) as string;
    const level = b?.level;
    if (!LEVELS.includes(level)) throw new BadRequestException(`level must be one of: ${LEVELS.join(', ')}`);
    const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)}`;
    const clash = await this.prisma.leadershipPosition.findFirst({ where: { OR: [{ fellowship_id: null }, { fellowship_id: f }], name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new ConflictException('A position with this name already exists.');
    const p = await this.prisma.leadershipPosition.create({ data: { fellowship_id: f, key, name, level, description: text('description', b?.description, 300), sort_order: 200, created_by: user.userId } });
    await this.audit.log({ userId: user.userId, action: 'leadership.position_create', entityType: 'leadership_position', entityId: p.id, newValue: { name, level } });
    return p;
  }

  async updatePosition(user: any, id: string, b: any) {
    const f = this.fellowship(user);
    if (!this.canConfigure(user)) throw new ForbiddenException('Only the Fellowship Administrator or Secretary configures positions.');
    if (!isUuid(id)) throw new NotFoundException('Position not found');
    const p = await this.prisma.leadershipPosition.findFirst({ where: { id, fellowship_id: f } });
    if (!p) throw new NotFoundException('Position not found'); // built-in positions belong to FEMS and are not edited
    const data: any = {};
    if (b?.name !== undefined) data.name = text('name', b.name, 100, true);
    if (b?.description !== undefined) data.description = text('description', b.description, 300);
    if (b?.isActive !== undefined) data.is_active = b.isActive === true;
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    const saved = await this.prisma.leadershipPosition.update({ where: { id }, data });
    await this.audit.log({ userId: user.userId, action: 'leadership.position_update', entityType: 'leadership_position', entityId: id, newValue: { fields: Object.keys(data) } });
    return saved;
  }

  private async loadPosition(fellowshipId: string, id: unknown) {
    if (!isUuid(id)) throw new BadRequestException('positionId must be a valid id');
    const p = await this.prisma.leadershipPosition.findFirst({ where: { id, OR: [{ fellowship_id: null }, { fellowship_id: fellowshipId }] } });
    if (!p) throw new NotFoundException('Position not found');
    return p;
  }

  private seat(fellowshipId: string, positionId: string, scope: string | null) {
    return `${fellowshipId}:${positionId}:${scope ?? 'fellowship'}`;
  }

  // ===================== reconciliation =====================

  /**
   * Brings the appointment record in line with the offices as they actually stand in FEMS. Offices given or taken
   * away in another screen (Users, Departments, Groups) start or end an appointment here, so every module and this
   * directory always agree. Suspended appointments are left alone.
   */
  async reconcile(fellowshipId: string) {
    const positions = await this.prisma.leadershipPosition.findMany({ where: { fellowship_id: null, is_system: true } });
    const byRole = new Map(positions.map((p) => [p.system_role!, p]));
    const [dl, gl, officers] = await Promise.all([
      this.prisma.departmentLeader.findMany({ where: { active_role: { not: null }, member_id: { not: null }, department: { fellowship_id: fellowshipId } }, include: { member: { select: { full_name: true, member_code: true } } } }),
      this.prisma.memberGroupMember.findMany({ where: { leader_role: { not: null }, group: { fellowship_id: fellowshipId } }, include: { member: { select: { full_name: true, member_code: true } } } }),
      this.prisma.user.findMany({ where: { fellowship_id: fellowshipId, is_active: true, deleted_at: null, roles: { hasSome: FELLOWSHIP_ROLES } }, select: { roles: true, created_at: true, member: { select: { id: true, full_name: true, member_code: true } } }, orderBy: { created_at: 'asc' } }),
    ]);
    type Want = { position: any; scope: string | null; dept?: string; group?: string; memberId: string; name: string; code: string | null; start: Date };
    const want: Want[] = [];
    for (const r of dl) { const p = byRole.get(r.active_role!); if (p) want.push({ position: p, scope: r.department_id, dept: r.department_id, memberId: r.member_id!, name: r.member!.full_name, code: r.member!.member_code, start: r.start_date }); }
    for (const r of gl) { const p = byRole.get(r.leader_role!); if (p) want.push({ position: p, scope: r.group_id, group: r.group_id, memberId: r.member_id, name: r.member.full_name, code: r.member.member_code, start: r.joined_at }); }
    for (const u of officers) {
      if (!u.member) continue;
      for (const role of u.roles.filter((x) => FELLOWSHIP_ROLES.includes(x))) {
        const p = byRole.get(role);
        if (p) want.push({ position: p, scope: null, memberId: u.member.id, name: u.member.full_name, code: u.member.member_code, start: u.created_at });
      }
    }
    const k = (positionId: string, scope: string | null, member: string | null) => `${positionId}|${scope ?? 'f'}|${member}`;
    const wanted = new Set(want.map((w) => k(w.position.id, w.scope, w.memberId)));
    const current = await this.prisma.leadershipAppointment.findMany({ where: { fellowship_id: fellowshipId, status: { in: ['active', 'suspended'] }, position: { is_system: true } } });
    const have = new Set(current.map((a) => k(a.position_id, a.department_id ?? a.group_id, a.member_id)));
    for (const a of current) {
      if (a.status !== 'active' || wanted.has(k(a.position_id, a.department_id ?? a.group_id, a.member_id))) continue;
      await this.prisma.leadershipAppointment.updateMany({
        where: { id: a.id, status: 'active' },
        data: { status: 'former', active_key: null, ended_at: new Date(), end_reason: 'other', end_notes: 'The office was changed in another FEMS screen.' },
      });
    }
    for (const w of want) {
      if (have.has(k(w.position.id, w.scope, w.memberId))) continue;
      try {
        await this.prisma.leadershipAppointment.create({ data: {
          fellowship_id: fellowshipId, position_id: w.position.id, member_id: w.memberId, member_name: w.name, member_code: w.code, level: w.position.level,
          department_id: w.dept ?? null, group_id: w.group ?? null, appointment_date: w.start, term_start: w.start, status: 'active',
          active_key: this.seat(fellowshipId, w.position.id, w.scope), source: 'sync',
        } });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // the seat is already recorded for someone else (e.g. two accounts with one office)
      }
    }
  }

  // ===================== write-through to where each office takes effect =====================

  /** Gives (memberId) or takes away (null) a fellowship office on the member's account. */
  private async setFellowshipRole(fellowshipId: string, role: string, grantTo: string | null, revokeFrom: string | null) {
    await this.prisma.$transaction(async (tx: Tx) => {
      if (revokeFrom) {
        const u = await tx.user.findFirst({ where: { id: revokeFrom, fellowship_id: fellowshipId } });
        if (u) await tx.user.update({ where: { id: u.id }, data: { roles: u.roles.filter((r) => r !== role) } });
      }
      if (grantTo) {
        // One holder of a fellowship office at a time: anyone else holding it loses it.
        const others = await tx.user.findMany({ where: { fellowship_id: fellowshipId, roles: { has: role }, id: { not: grantTo } } });
        for (const o of others) await tx.user.update({ where: { id: o.id }, data: { roles: o.roles.filter((r) => r !== role) } });
        const u = await tx.user.findUniqueOrThrow({ where: { id: grantTo } });
        if (!u.roles.includes(role)) await tx.user.update({ where: { id: u.id }, data: { roles: [...u.roles, role] } });
      }
    });
  }

  private async accountOf(member: any, fellowshipId: string) {
    if (!member.user_id) throw new BadRequestException(`${member.full_name} has no FEMS login. Invite them from Users first, then appoint them.`);
    const u = await this.prisma.user.findFirst({ where: { id: member.user_id, fellowship_id: fellowshipId, is_active: true, deleted_at: null } });
    if (!u) throw new BadRequestException(`${member.full_name}'s login is not active.`);
    return u;
  }

  /** Makes the office take effect where it lives. Returns extra information (e.g. a new account's first password). */
  private async grant(user: any, position: any, scope: { departmentId: string | null; groupId: string | null }, member: any, fellowshipId: string) {
    if (!position.is_system) return {};
    if (position.level === 'department') {
      const r = await this.departments.appoint(user, scope.departmentId!, { role: position.system_role, memberId: member.id });
      return { account: r.account };
    }
    if (position.level === 'group') {
      await this.groups.setLeaders(scope.groupId!, position.system_role === 'male_leader' ? { maleLeaderId: member.id } : { femaleLeaderId: member.id }, user);
      return {};
    }
    const account = await this.accountOf(member, fellowshipId);
    await this.setFellowshipRole(fellowshipId, position.system_role, account.id, null);
    return {};
  }

  /** Takes the office away where it lives (ending, suspending). */
  private async revoke(user: any, position: any, a: any, reason: string) {
    if (!position.is_system) return;
    if (position.level === 'department') {
      const holder = await this.prisma.departmentLeader.findFirst({ where: { department_id: a.department_id, active_role: position.system_role } });
      if (holder && holder.member_id === a.member_id) await this.departments.vacate(user, a.department_id, position.system_role, reason);
      return;
    }
    if (position.level === 'group') {
      const holder = await this.prisma.memberGroupMember.findFirst({ where: { group_id: a.group_id, leader_role: position.system_role } });
      if (holder && holder.member_id === a.member_id) await this.groups.setLeaders(a.group_id, position.system_role === 'male_leader' ? { maleLeaderId: null } : { femaleLeaderId: null }, user);
      return;
    }
    const member = a.member_id ? await this.prisma.member.findUnique({ where: { id: a.member_id } }) : null;
    if (member?.user_id) await this.setFellowshipRole(a.fellowship_id, position.system_role, null, member.user_id);
  }

  // ===================== appointments =====================

  private async scopeOf(fellowshipId: string, position: any, b: any) {
    let departmentId: string | null = null;
    let groupId: string | null = null;
    if (position.level === 'department') {
      if (!isUuid(b?.departmentId)) throw new BadRequestException('Choose the department.');
      const d = await this.prisma.department.findFirst({ where: { id: b.departmentId, fellowship_id: fellowshipId } });
      if (!d) throw new BadRequestException('The department is not available.');
      if (!d.is_active) throw new BadRequestException('That department is inactive.');
      departmentId = d.id;
    } else if (position.level === 'group') {
      if (!isUuid(b?.groupId)) throw new BadRequestException('Choose the group.');
      const g = await this.prisma.memberGroup.findFirst({ where: { id: b.groupId, fellowship_id: fellowshipId } });
      if (!g) throw new BadRequestException('The group is not available.');
      groupId = g.id;
    }
    return { departmentId, groupId, scope: departmentId ?? groupId };
  }

  /**
   * Appoints a registered member. If the office is held, the current holder's appointment ends as "replaced" and
   * moves to the history; a former leader appointed again gets a NEW appointment, the old one untouched.
   */
  async appoint(user: any, b: any) {
    const fellowshipId = this.fellowship(user);
    const position = await this.loadPosition(fellowshipId, b?.positionId);
    if (!position.is_active) throw new BadRequestException('This position is no longer in use.');
    this.requireManager(user, position);
    if (!isUuid(b?.memberId)) throw new BadRequestException('Choose a registered member.');
    const member = await this.prisma.member.findFirst({ where: { id: b.memberId, fellowship_id: fellowshipId } });
    if (!member) throw new BadRequestException('Only a registered member of this fellowship can be appointed.');
    if (member.membership_status !== 'active') throw new BadRequestException(`${member.full_name} is not an active member.`);
    const { departmentId, groupId, scope } = await this.scopeOf(fellowshipId, position, b);
    const appointmentDate = date('appointmentDate', b?.appointmentDate) ?? new Date();
    const termStart = date('termStart', b?.termStart) ?? appointmentDate;
    const termEnd = date('termEnd', b?.termEnd);
    if (appointmentDate.getTime() > Date.now() + 366 * DAY) throw new BadRequestException('appointmentDate is too far in the future.');
    if (termStart < new Date(appointmentDate.getTime() - 366 * DAY)) throw new BadRequestException('termStart cannot be long before the appointment.');
    if (termEnd && termEnd <= termStart) throw new BadRequestException('The term must end after it starts.');
    const notes = text('notes', b?.notes, 1000);
    const seat = this.seat(fellowshipId, position.id, scope);

    await this.reconcile(fellowshipId);
    const previous = await this.prisma.leadershipAppointment.findUnique({ where: { active_key: seat } });
    if (previous && previous.member_id === member.id) throw new ConflictException(`${member.full_name} already holds this office.`);

    let extra: any = {};
    if (position.is_system) {
      extra = await this.grant(user, position, { departmentId, groupId }, member, fellowshipId);
      await this.reconcile(fellowshipId); // picks up the new holder and ends the replaced one
    } else {
      await this.prisma.$transaction(async (tx: Tx) => {
        if (previous) await tx.leadershipAppointment.update({ where: { id: previous.id }, data: { status: 'former', active_key: null, ended_at: new Date(), end_reason: 'replaced', ended_by: user.userId } });
        await tx.leadershipAppointment.create({ data: { fellowship_id: fellowshipId, position_id: position.id, member_id: member.id, member_name: member.full_name, member_code: member.member_code, level: position.level, department_id: departmentId, group_id: groupId, appointment_date: appointmentDate, term_start: termStart, status: 'active', active_key: seat } });
      }).catch((e) => { if (e?.code === 'P2002') throw new ConflictException('This office was filled at the same time. Refresh and try again.'); throw e; });
    }
    const created = await this.prisma.leadershipAppointment.findUnique({ where: { active_key: seat } });
    if (!created || created.member_id !== member.id) throw new ConflictException('The appointment could not be confirmed. Refresh and try again.');
    await this.prisma.leadershipAppointment.update({ where: { id: created.id }, data: { appointment_date: appointmentDate, term_start: termStart, term_end: termEnd, notes, appointed_by: user.userId, source: 'leadership' } });
    if (previous) await this.prisma.leadershipAppointment.updateMany({ where: { id: previous.id, status: 'former' }, data: { end_reason: 'replaced', ended_by: user.userId, end_notes: `Replaced by ${member.full_name}` } });

    await this.audit.log({
      userId: user.userId, action: previous ? 'leadership.replace' : 'leadership.appoint', entityType: 'leadership_appointment', entityId: created.id,
      oldValue: previous ? { appointmentId: previous.id, memberId: previous.member_id } : undefined,
      newValue: { position: position.key, memberId: member.id, departmentId, groupId, termStart: termStart.toISOString(), termEnd: termEnd?.toISOString() ?? null },
    });
    if (member.user_id && position.level !== 'department') {
      await this.notifications.create({ recipientUserId: member.user_id, eventType: 'leadership_appointed', title: `Appointed ${position.name}`, message: `You have been appointed ${position.name}.`, entityType: 'leadership_appointment', entityId: created.id, fellowshipId }).catch(() => undefined);
    }
    return { appointment: await this.detail(user, created.id), ...extra };
  }

  private async loadAppointment(user: any, id: string) {
    const fellowshipId = this.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Appointment not found');
    const a = await this.prisma.leadershipAppointment.findFirst({ where: { id, fellowship_id: fellowshipId }, include: { position: true } });
    if (!a) throw new NotFoundException('Appointment not found');
    return a;
  }

  /** Ends an appointment: resigned, term completed, removed... It moves to the history and is never deleted. */
  async end(user: any, id: string, b: any) {
    const a = await this.loadAppointment(user, id);
    this.requireManager(user, a.position);
    if (a.status === 'former') throw new ConflictException('This appointment has already ended.');
    const reason = b?.reason;
    if (!END_REASONS.includes(reason) || reason === 'replaced') throw new BadRequestException('reason must be resigned, term_completed, removed or other (replacing is done by appointing the new leader)');
    const endDate = date('endDate', b?.endDate) ?? new Date();
    if (endDate > new Date(Date.now() + DAY)) throw new BadRequestException('endDate cannot be in the future.');
    if (endDate < a.term_start) throw new BadRequestException('endDate cannot be before the term started.');
    const notes = text('notes', b?.notes, 1000);
    if (reason === 'other' && !notes) throw new BadRequestException('Describe why the appointment ended.');
    if (a.status === 'active') await this.revoke(user, a.position, a, reason.replace('_', ' '));
    await this.prisma.leadershipAppointment.update({ where: { id }, data: { status: 'former', active_key: null, ended_at: endDate, end_reason: reason, end_notes: notes, ended_by: user.userId } });
    await this.audit.log({ userId: user.userId, action: 'leadership.end', entityType: 'leadership_appointment', entityId: id, oldValue: { status: a.status }, newValue: { reason, endDate: endDate.toISOString() }, comment: notes ?? undefined });
    return this.detail(user, id);
  }

  /** Suspension takes the office's access away but keeps the appointment, so it can be reinstated. */
  async suspend(user: any, id: string, b: any) {
    const a = await this.loadAppointment(user, id);
    this.requireManager(user, a.position);
    if (a.status !== 'active') throw new ConflictException('Only an active appointment can be suspended.');
    const reason = text('reason', b?.reason, 500, true) as string;
    await this.prisma.leadershipAppointment.update({ where: { id }, data: { status: 'suspended', active_key: null, suspended_at: new Date(), suspension_reason: reason } });
    try { await this.revoke(user, a.position, a, `suspended: ${reason}`); } catch (e) {
      await this.prisma.leadershipAppointment.update({ where: { id }, data: { status: 'active', active_key: a.active_key, suspended_at: null, suspension_reason: null } });
      throw e;
    }
    await this.audit.log({ userId: user.userId, action: 'leadership.suspend', entityType: 'leadership_appointment', entityId: id, comment: reason });
    return this.detail(user, id);
  }

  async reinstate(user: any, id: string) {
    const a = await this.loadAppointment(user, id);
    this.requireManager(user, a.position);
    if (a.status !== 'suspended') throw new ConflictException('Only a suspended appointment can be reinstated.');
    if (!a.member_id) throw new ConflictException('The member record no longer exists.');
    const seat = this.seat(a.fellowship_id, a.position_id, a.department_id ?? a.group_id);
    await this.reconcile(a.fellowship_id);
    const taken = await this.prisma.leadershipAppointment.findUnique({ where: { active_key: seat } });
    if (taken) throw new ConflictException('Someone else now holds this office. End that appointment first.');
    await this.prisma.leadershipAppointment.update({ where: { id }, data: { status: 'active', active_key: seat, suspended_at: null } });
    try {
      const member = await this.prisma.member.findUniqueOrThrow({ where: { id: a.member_id } });
      await this.grant(user, a.position, { departmentId: a.department_id, groupId: a.group_id }, member, a.fellowship_id);
    } catch (e) {
      await this.prisma.leadershipAppointment.update({ where: { id }, data: { status: 'suspended', active_key: null } });
      throw e;
    }
    await this.audit.log({ userId: user.userId, action: 'leadership.reinstate', entityType: 'leadership_appointment', entityId: id });
    return this.detail(user, id);
  }

  async updateTerm(user: any, id: string, b: any) {
    const a = await this.loadAppointment(user, id);
    this.requireManager(user, a.position);
    if (a.status === 'former') throw new ConflictException('A past appointment is kept as it was.');
    const data: any = {};
    if (b?.termEnd !== undefined) {
      data.term_end = date('termEnd', b.termEnd);
      if (data.term_end && data.term_end <= a.term_start) throw new BadRequestException('The term must end after it starts.');
    }
    if (b?.notes !== undefined) data.notes = text('notes', b.notes, 1000);
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    await this.prisma.leadershipAppointment.update({ where: { id }, data });
    await this.audit.log({ userId: user.userId, action: 'leadership.term_update', entityType: 'leadership_appointment', entityId: id, newValue: { fields: Object.keys(data) } });
    return this.detail(user, id);
  }

  // ===================== reads =====================

  private async decorate(rows: any[]) {
    const deptIds = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean)));
    const groupIds = Array.from(new Set(rows.map((r) => r.group_id).filter(Boolean)));
    const [depts, groups] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
      this.prisma.memberGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }),
    ]);
    const dn = new Map(depts.map((d) => [d.id, d.name]));
    const gn = new Map(groups.map((g) => [g.id, g.name]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id, status: r.status, level: r.level,
      position: { id: r.position.id, key: r.position.key, name: r.position.name, isSystem: r.position.is_system },
      departmentId: r.department_id, departmentName: r.department_id ? dn.get(r.department_id) ?? null : null,
      groupId: r.group_id, groupName: r.group_id ? gn.get(r.group_id) ?? null : null,
      appointmentDate: r.appointment_date, termStart: r.term_start, termEnd: r.term_end,
      termEnded: r.status !== 'former' && !!r.term_end && r.term_end < now,
      endedAt: r.ended_at, endReason: r.end_reason, endNotes: r.end_notes,
      suspendedAt: r.suspended_at, suspensionReason: r.suspension_reason, notes: r.notes, source: r.source,
      member: {
        id: r.member_id,
        fullName: r.member?.full_name ?? r.member_name,
        registrationNumber: r.member?.member_code ?? r.member_code,
        gender: r.member?.gender ?? null, phone: r.member?.phone ?? null, email: r.member?.email ?? null, photoUrl: r.member?.photo_url ?? null,
        stillRegistered: !!r.member,
      },
    }));
  }

  private memberSelect = { select: { full_name: true, member_code: true, gender: true, phone: true, email: true, photo_url: true } };

  async list(user: any, q: any) {
    const fellowshipId = this.requireViewer(user);
    await this.reconcile(fellowshipId);
    const where: any = { fellowship_id: fellowshipId };
    const tab = q?.tab === 'history' ? 'history' : 'current';
    where.status = tab === 'history' ? 'former' : { in: ['active', 'suspended'] };
    if (q?.status && ['active', 'suspended', 'former'].includes(q.status)) where.status = q.status;
    if (q?.positionId && isUuid(q.positionId)) where.position_id = q.positionId;
    if (q?.level && LEVELS.includes(q.level)) where.level = q.level;
    if (q?.departmentId && isUuid(q.departmentId)) where.department_id = q.departmentId;
    if (q?.groupId && isUuid(q.groupId)) where.group_id = q.groupId;
    const and: any[] = [];
    if (q?.search) {
      const term = text('search', q.search, 100) as string;
      and.push({ OR: [{ member_name: { contains: term, mode: 'insensitive' } }, { member_code: { contains: term, mode: 'insensitive' } }, { member: { full_name: { contains: term, mode: 'insensitive' } } }, { member: { member_code: { contains: term, mode: 'insensitive' } } }] });
    }
    if (q?.year) {
      const y = Number(q.year);
      if (!Number.isInteger(y) || y < 1990 || y > 2100) throw new BadRequestException('year must be a year such as 2026');
      // Serving at any time during that year.
      and.push({ term_start: { lt: new Date(Date.UTC(y + 1, 0, 1)) } }, { OR: [{ ended_at: null }, { ended_at: { gte: new Date(Date.UTC(y, 0, 1)) } }] });
    }
    if (and.length) where.AND = and;
    const limit = Math.min(200, Math.max(1, Number(q?.limit) || 50));
    const page = Math.max(1, Number(q?.page) || 1);
    const [rows, total] = await Promise.all([
      this.prisma.leadershipAppointment.findMany({ where, orderBy: tab === 'history' ? [{ ended_at: 'desc' }] : [{ position: { sort_order: 'asc' } }, { term_start: 'desc' }], take: limit, skip: (page - 1) * limit, include: { position: true, member: this.memberSelect } }),
      this.prisma.leadershipAppointment.count({ where }),
    ]);
    return { data: await this.decorate(rows), total, page, limit, tab };
  }

  async detail(user: any, id: string) {
    this.requireViewer(user);
    const a = await this.loadAppointment(user, id);
    const full = await this.prisma.leadershipAppointment.findUniqueOrThrow({ where: { id }, include: { position: true, member: this.memberSelect } });
    const [shaped] = await this.decorate([full]);
    const names = await this.prisma.user.findMany({ where: { id: { in: [a.appointed_by, a.ended_by].filter((x): x is string => !!x) } }, select: { id: true, first_name: true, last_name: true } });
    const nm = new Map(names.map((u) => [u.id, `${u.first_name} ${u.last_name}`]));
    return { ...shaped, appointedBy: a.appointed_by ? nm.get(a.appointed_by) ?? null : null, endedBy: a.ended_by ? nm.get(a.ended_by) ?? null : null };
  }

  /** A leader's profile: their member details and every appointment they have held. */
  async memberProfile(user: any, memberId: string) {
    const fellowshipId = this.requireViewer(user);
    if (!isUuid(memberId)) throw new NotFoundException('Member not found');
    const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId }, select: { id: true, full_name: true, member_code: true, gender: true, phone: true, email: true, photo_url: true, membership_status: true } });
    if (!m) throw new NotFoundException('Member not found');
    await this.reconcile(fellowshipId);
    const rows = await this.prisma.leadershipAppointment.findMany({ where: { fellowship_id: fellowshipId, member_id: memberId }, include: { position: true, member: this.memberSelect }, orderBy: { term_start: 'desc' } });
    return { member: { id: m.id, fullName: m.full_name, registrationNumber: m.member_code, gender: m.gender, phone: m.phone, email: m.email, photoUrl: m.photo_url, status: m.membership_status }, appointments: await this.decorate(rows) };
  }

  /** Departments and groups of the fellowship, for the appointment form and filters. */
  async scopes(user: any) {
    const fellowshipId = this.requireViewer(user);
    const [departments, groups] = await Promise.all([
      this.prisma.department.findMany({ where: { fellowship_id: fellowshipId }, select: { id: true, name: true, is_active: true }, orderBy: { name: 'asc' } }),
      this.prisma.memberGroup.findMany({ where: { fellowship_id: fellowshipId }, select: { id: true, name: true, is_active: true }, orderBy: { name: 'asc' } }),
    ]);
    return { departments, groups };
  }

  /** Registered members to choose from when appointing (name, number, gender, whether they can log in). */
  async searchMembers(user: any, q: any) {
    const fellowshipId = this.requireViewer(user);
    const term = text('q', q?.q, 100) ?? '';
    const rows = await this.prisma.member.findMany({
      where: { fellowship_id: fellowshipId, membership_status: 'active', ...(term ? { OR: [{ full_name: { contains: term, mode: 'insensitive' } }, { member_code: { contains: term, mode: 'insensitive' } }] } : {}) },
      select: { id: true, full_name: true, member_code: true, gender: true, email: true, user_id: true, photo_url: true },
      orderBy: { full_name: 'asc' }, take: 20,
    });
    return rows.map((m) => ({ id: m.id, fullName: m.full_name, registrationNumber: m.member_code, gender: m.gender, hasEmail: !!m.email, hasLogin: !!m.user_id, photoUrl: m.photo_url }));
  }

  async setPhoto(user: any, memberId: string, b: any) {
    const fellowshipId = this.fellowship(user);
    if (!this.has(user, 'fellowship_admin', 'secretary', 'assistant_secretary')) throw new ForbiddenException('You cannot change member photos.');
    if (!isUuid(memberId)) throw new NotFoundException('Member not found');
    const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId } });
    if (!m) throw new NotFoundException('Member not found');
    let url: string | null = null;
    if (b?.photo) {
      const [photo] = validateAttachments('photo', [b.photo]);
      if (photo.type && !photo.type.startsWith('image/')) throw new BadRequestException('The photo must be an image.');
      url = photo.url;
    }
    await this.prisma.member.update({ where: { id: memberId }, data: { photo_url: url } });
    await this.audit.log({ userId: user.userId, action: 'member.photo_update', entityType: 'member', entityId: memberId });
    return { photoUrl: url };
  }

  /** The current holder(s) of an office, for any part of FEMS that needs to show "who leads this". */
  async current(user: any, q: any) {
    const fellowshipId = this.requireViewer(user);
    await this.reconcile(fellowshipId);
    const where: any = { fellowship_id: fellowshipId, status: 'active' };
    if (q?.positionKey) where.position = { key: String(q.positionKey) };
    if (q?.departmentId && isUuid(q.departmentId)) where.department_id = q.departmentId;
    if (q?.groupId && isUuid(q.groupId)) where.group_id = q.groupId;
    const rows = await this.prisma.leadershipAppointment.findMany({ where, include: { position: true, member: this.memberSelect }, take: 200 });
    return this.decorate(rows);
  }

  async exportReport(user: any, q: any): Promise<Report> {
    const all: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.list(user, { ...q, page, limit: 200 });
      all.push(...r.data);
      if (all.length >= r.total) break;
    }
    const history = q?.tab === 'history';
    const col = (key: string, label: string): ReportColumn => ({ key, label });
    const fellowship = await this.prisma.fellowship.findUnique({ where: { id: user.fellowshipId }, select: { name: true } });
    await this.audit.log({ userId: user.userId, action: 'leadership.export', entityType: 'leadership', newValue: { tab: history ? 'history' : 'current', format: q?.format ?? 'json', count: all.length } });
    return {
      key: history ? 'leadership-history' : 'current-leaders', title: history ? 'Leadership history' : 'Current leaders',
      subtitle: fellowship?.name ?? '', generatedAt: new Date(), currency: '', summary: [{ label: 'Appointments', value: String(all.length) }],
      columns: [col('name', 'Name'), col('number', 'Registration no.'), col('position', 'Position'), col('unit', 'Department / group'), col('phone', 'Phone'), col('email', 'E-mail'), col('from', 'Term start'), col('to', history ? 'Ended' : 'Term end'), col('status', 'Status'), ...(history ? [col('reason', 'Reason')] : [])],
      rows: all.map((a) => ({
        name: a.member.fullName, number: a.member.registrationNumber, position: a.position.name, unit: a.departmentName ?? a.groupName ?? 'Fellowship',
        phone: a.member.phone, email: a.member.email, from: a.termStart, to: history ? a.endedAt : a.termEnd, status: a.status, reason: a.endReason ? `${a.endReason.replace('_', ' ')}${a.endNotes ? `: ${a.endNotes}` : ''}` : '',
      })),
    };
  }
}
