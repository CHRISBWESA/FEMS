import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ROLE_DEFINITIONS } from '../shared/authorization/roles';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import {
  INITIAL_LEADER_PASSWORD,
  LEADER_ROLES,
  LEADER_ROLE_LABEL,
  LeaderRole,
  STANDARD_DEPARTMENTS,
  genderOf,
  isLeaderRole,
  splitName,
} from './department.util';

type Tx = Prisma.TransactionClient;

const permissionsFor = (roles: string[]) =>
  Array.from(
    new Set(ROLE_DEFINITIONS.filter((d) => roles.includes(d.name)).flatMap((d) => d.permissions)),
  );

/**
 * The Fellowship Secretary's side of departments: creating and editing departments, and appointing or replacing
 * their two leaders. Replacing a leader changes only the appointment and the access that comes with it - the
 * department, its members, activities, reports and requests are never touched.
 */
@Injectable()
export class DepartmentLeadershipService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
  ) {}

  // ---------------------------------------------------------------- departments

  async list(user: any): Promise<any[]> {
    const fellowshipId = this.access.requireSecretary(user);
    const departments = await this.prisma.department.findMany({
      where: { fellowship_id: fellowshipId },
      orderBy: { name: 'asc' },
      include: {
        leaders: {
          where: { active_role: { not: null } },
          include: {
            member: { select: { id: true, full_name: true, member_code: true, email: true } },
          },
        },
        members: { where: { removed: false }, select: { member: { select: { gender: true } } } },
      },
    });
    return departments.map((d) => this.summary(d));
  }

  private summary(d: any) {
    const genders = (d.members || []).map((m: any) => genderOf(m.member?.gender));
    const leader = (role: LeaderRole) => {
      const l = (d.leaders || []).find((x: any) => x.active_role === role);
      return l
        ? {
            id: l.id,
            memberId: l.member_id,
            userId: l.user_id,
            fullName: l.member?.full_name ?? null,
            memberCode: l.member?.member_code ?? null,
            email: l.member?.email ?? null,
            since: l.start_date,
          }
        : null;
    };
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      isActive: d.is_active,
      createdAt: d.created_at,
      memberCount: genders.length,
      maleCount: genders.filter((g: string | null) => g === 'male').length,
      femaleCount: genders.filter((g: string | null) => g === 'female').length,
      chairperson: leader('department_chairperson'),
      secretary: leader('department_secretary'),
    };
  }

  async get(user: any, id: string): Promise<any> {
    this.access.requireSecretary(user);
    const dept = await this.access.loadInFellowship(user, id);
    const full = await this.prisma.department.findUnique({
      where: { id: dept.id },
      include: {
        leaders: {
          where: { active_role: { not: null } },
          include: {
            member: { select: { id: true, full_name: true, member_code: true, email: true } },
          },
        },
        members: { where: { removed: false }, select: { member: { select: { gender: true } } } },
      },
    });
    return { ...this.summary(full), history: await this.history(dept.id) };
  }

  private async assertNameFree(
    fellowshipId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.department.findFirst({
      where: {
        fellowship_id: fellowshipId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new BadRequestException('This fellowship already has a department with that name.');
  }

  async create(user: any, body: any): Promise<any> {
    const fellowshipId = this.access.requireSecretary(user);
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const name = (validateText('name', body.name, 120, true) as string).replace(/\s+/g, ' ');
    const description = validateText('description', body.description, 1000);
    await this.assertNameFree(fellowshipId, name);
    const dept = await this.prisma.department
      .create({
        data: {
          name,
          description,
          is_active: body.isActive === undefined ? true : !!body.isActive,
          created_by: user.userId,
          fellowship_id: fellowshipId,
          custom_fields_schema: {},
        },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new BadRequestException('This fellowship already has a department with that name.');
        throw e;
      });
    await this.audit.log({
      userId: user.userId,
      action: 'department.create',
      entityType: 'department',
      entityId: dept.id,
      newValue: { name, description, isActive: dept.is_active },
    });
    return this.get(user, dept.id);
  }

  async update(user: any, id: string, body: any): Promise<any> {
    this.access.requireSecretary(user);
    const dept = await this.access.loadInFellowship(user, id);
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const changes: Record<string, any> = {};
    if (body.name !== undefined) {
      changes.name = (validateText('name', body.name, 120, true) as string).replace(/\s+/g, ' ');
      await this.assertNameFree(dept.fellowship_id, changes.name, id);
    }
    if (body.description !== undefined)
      changes.description = validateText('description', body.description, 1000);
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean')
        throw new BadRequestException('isActive must be true or false');
      changes.is_active = body.isActive;
    }
    if (Object.keys(changes).length === 0) throw new BadRequestException('No fields to update');
    const updated = await this.prisma.department.update({ where: { id }, data: changes });
    await this.audit.log({
      userId: user.userId,
      action:
        changes.is_active === undefined
          ? 'department.edit'
          : changes.is_active
            ? 'department.activate'
            : 'department.deactivate',
      entityType: 'department',
      entityId: id,
      oldValue: { name: dept.name, description: dept.description, isActive: dept.is_active },
      newValue: {
        name: updated.name,
        description: updated.description,
        isActive: updated.is_active,
      },
    });
    return this.get(user, id);
  }

  /** Creates whichever of the ten standard departments the fellowship does not have yet. */
  async addStandard(user: any): Promise<{ created: string[]; existing: string[] }> {
    const fellowshipId = this.access.requireSecretary(user);
    const have = await this.prisma.department.findMany({
      where: { fellowship_id: fellowshipId },
      select: { name: true },
    });
    const haveLower = new Set(have.map((d) => d.name.toLowerCase()));
    const missing = STANDARD_DEPARTMENTS.filter((n) => !haveLower.has(n.toLowerCase()));
    if (missing.length) {
      await this.prisma.department.createMany({
        data: missing.map((name) => ({
          name,
          is_active: true,
          created_by: user.userId,
          fellowship_id: fellowshipId,
          custom_fields_schema: {},
        })),
        skipDuplicates: true,
      });
      await this.audit.log({
        userId: user.userId,
        action: 'department.create_standard',
        entityType: 'department',
        newValue: { created: missing },
      });
    }
    return {
      created: missing,
      existing: STANDARD_DEPARTMENTS.filter((n) => haveLower.has(n.toLowerCase())),
    };
  }

  // ---------------------------------------------------------------- leadership

  async history(departmentId: string): Promise<any[]> {
    const rows = await this.prisma.departmentLeader.findMany({
      where: { department_id: departmentId },
      include: { member: { select: { full_name: true, member_code: true } } },
      orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    });
    const actorIds = Array.from(
      new Set(rows.flatMap((r) => [r.appointed_by, r.ended_by]).filter(Boolean)),
    ) as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    const nameOf = (id: string | null) => {
      const a = actors.find((x) => x.id === id);
      return a ? `${a.first_name} ${a.last_name}`.trim() : null;
    };
    return rows.map((r) => ({
      id: r.id,
      role: r.role_in_department,
      memberId: r.member_id,
      fullName: r.member?.full_name ?? null,
      memberCode: r.member?.member_code ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      current: !!r.active_role,
      endReason: r.end_reason,
      appointedBy: nameOf(r.appointed_by),
      endedBy: nameOf(r.ended_by),
    }));
  }

  /**
   * Appoints a registered member as the department's Chairperson or Secretary, replacing whoever holds the office.
   * Their existing account is reused (and its password left alone); a member without one gets an account with the
   * initial password and must change it at first login.
   */
  async appoint(user: any, departmentId: string, body: any): Promise<any> {
    const fellowshipId = this.access.requireSecretary(user);
    const dept = await this.access.loadInFellowship(user, departmentId);
    const role = body?.role;
    if (!isLeaderRole(role))
      throw new BadRequestException('role must be department_chairperson or department_secretary');
    const memberId = body?.memberId;
    if (!isUuid(memberId)) throw new BadRequestException('memberId must be a registered member');

    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member || member.fellowship_id !== fellowshipId)
      throw new BadRequestException('Member not found in this fellowship.');
    if (member.membership_status !== 'active')
      throw new BadRequestException('Only an active member can be appointed.');
    if (!member.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) {
      throw new BadRequestException(
        `${member.full_name} has no valid e-mail address on record, which is needed for their login. Add one to the member record first.`,
      );
    }

    const otherRole: LeaderRole =
      role === 'department_chairperson' ? 'department_secretary' : 'department_chairperson';
    const current = await this.prisma.departmentLeader.findMany({
      where: { department_id: departmentId, active_role: { not: null } },
    });
    const holder = current.find((l) => l.active_role === role);
    const other = current.find((l) => l.active_role === otherRole);
    if (holder && holder.member_id === memberId)
      throw new BadRequestException(`${member.full_name} already holds this office.`);
    if (other && other.member_id === memberId) {
      throw new BadRequestException(
        `${member.full_name} is already the ${LEADER_ROLE_LABEL[otherRole]}. One person cannot hold both offices.`,
      );
    }

    // Hashed up front (it takes a moment) so the transaction below stays short; only used if an account is created.
    const initialHash = await bcrypt.hash(INITIAL_LEADER_PASSWORD, 12);
    const result = await this.prisma
      .$transaction(async (tx) => {
        const account = await this.resolveAccount(tx, member, role, departmentId, initialHash);
        if (other && other.user_id === account.userId) {
          throw new BadRequestException(
            'This account already holds the other office of this department.',
          );
        }
        if (holder) {
          await tx.departmentLeader.update({
            where: { id: holder.id },
            data: {
              active_role: null,
              end_date: new Date(),
              ended_by: user.userId,
              end_reason: 'replaced',
            },
          });
          await tx.leadershipHistory.updateMany({
            where: {
              user_id: holder.user_id,
              department_id: departmentId,
              role_name: role,
              end_date: null,
            },
            data: { end_date: new Date() },
          });
        }
        const appointment = await tx.departmentLeader.create({
          data: {
            department_id: departmentId,
            user_id: account.userId,
            member_id: member.id,
            role_in_department: role,
            active_role: role,
            start_date: new Date(),
            appointed_by: user.userId,
            fellowship_id: fellowshipId,
          },
        });
        await tx.leadershipHistory.create({
          data: {
            user_id: account.userId,
            role_name: role,
            department_id: departmentId,
            fellowship_id: fellowshipId,
            assigned_by: user.userId,
          },
        });
        // A leader is a member of the department they lead (reactivating an earlier membership if there is one).
        await tx.departmentMember.upsert({
          where: { department_id_member_id: { department_id: departmentId, member_id: member.id } },
          create: { department_id: departmentId, member_id: member.id },
          update: { removed: false, removed_at: null },
        });
        await this.syncAccountRoles(tx, account.userId);
        if (holder && holder.user_id !== account.userId)
          await this.syncAccountRoles(tx, holder.user_id);
        return { appointment, account, previousUserId: holder?.user_id ?? null };
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'The leadership of this department was changed at the same time. Please refresh and try again.',
          );
        }
        throw e;
      });

    await this.audit.log({
      userId: user.userId,
      action: holder ? 'department.leader_replace' : 'department.leader_appoint',
      entityType: 'department',
      entityId: departmentId,
      oldValue: holder ? { role, memberId: holder.member_id, userId: holder.user_id } : undefined,
      newValue: {
        role,
        memberId: member.id,
        userId: result.account.userId,
        accountCreated: result.account.created,
      },
    });
    if (result.account.created) {
      await this.audit.log({
        userId: user.userId,
        action: 'user.provision_department_leader',
        entityType: 'user',
        entityId: result.account.userId,
        newValue: { email: result.account.email, role },
      });
    }

    const label = LEADER_ROLE_LABEL[role as LeaderRole];
    await this.notifier.notify(
      [result.account.userId],
      {
        eventType: 'department_leader_appointed',
        title: `Appointed ${label}`,
        message: `You have been appointed ${label} of ${dept.name}.`,
        entityType: 'department',
        entityId: departmentId,
        fellowshipId,
      },
      user.userId,
    );
    if (result.previousUserId && result.previousUserId !== result.account.userId) {
      await this.notifier.notify(
        [result.previousUserId],
        {
          eventType: 'department_leader_replaced',
          title: 'Leadership changed',
          message: `${member.full_name} has replaced you as ${label} of ${dept.name}.`,
          entityType: 'department',
          entityId: departmentId,
          fellowshipId,
        },
        user.userId,
      );
    }
    if (other) {
      await this.notifier.notify(
        [other.user_id],
        {
          eventType: 'department_leadership_changed',
          title: 'Leadership changed',
          message: `${member.full_name} is now ${label} of ${dept.name}.`,
          entityType: 'department',
          entityId: departmentId,
          fellowshipId,
        },
        user.userId,
      );
    }

    return {
      department: await this.get(user, departmentId),
      account: {
        userId: result.account.userId,
        email: result.account.email,
        created: result.account.created,
        // Only shown when a new account was made; an existing account keeps its own password.
        initialPassword: result.account.created ? INITIAL_LEADER_PASSWORD : undefined,
      },
    };
  }

  /** Leaves an office vacant (the appointment is ended and kept in the history). */
  async vacate(user: any, departmentId: string, role: unknown, reason?: unknown): Promise<any> {
    const fellowshipId = this.access.requireSecretary(user);
    const dept = await this.access.loadInFellowship(user, departmentId);
    if (!isLeaderRole(role))
      throw new BadRequestException('role must be department_chairperson or department_secretary');
    const note = validateText('reason', reason, 300) || 'vacated';
    const holder = await this.prisma.departmentLeader.findFirst({
      where: { department_id: departmentId, active_role: role },
    });
    if (!holder) throw new NotFoundException('This office is already vacant.');
    await this.prisma.$transaction(async (tx) => {
      await tx.departmentLeader.update({
        where: { id: holder.id },
        data: { active_role: null, end_date: new Date(), ended_by: user.userId, end_reason: note },
      });
      await tx.leadershipHistory.updateMany({
        where: {
          user_id: holder.user_id,
          department_id: departmentId,
          role_name: role,
          end_date: null,
        },
        data: { end_date: new Date() },
      });
      await this.syncAccountRoles(tx, holder.user_id);
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department.leader_vacate',
      entityType: 'department',
      entityId: departmentId,
      oldValue: { role, memberId: holder.member_id, userId: holder.user_id },
      comment: note,
    });
    await this.notifier.notify(
      [holder.user_id],
      {
        eventType: 'department_leader_replaced',
        title: 'Leadership ended',
        message: `Your appointment as ${LEADER_ROLE_LABEL[role]} of ${dept.name} has ended.`,
        entityType: 'department',
        entityId: departmentId,
        fellowshipId,
      },
      user.userId,
    );
    return this.get(user, departmentId);
  }

  /**
   * The member's login account: theirs if linked, otherwise an unlinked account of the same fellowship with the
   * same e-mail (which is then linked), otherwise a new one. Never two accounts for one person.
   */
  private async resolveAccount(
    tx: Tx,
    member: any,
    role: LeaderRole,
    departmentId: string,
    initialHash: string,
  ): Promise<{ userId: string; email: string; created: boolean }> {
    const email = member.email.trim().toLowerCase();
    if (member.user_id) {
      const linked = await tx.user.findUnique({ where: { id: member.user_id } });
      if (linked && !linked.deleted_at && linked.fellowship_id === member.fellowship_id) {
        return { userId: linked.id, email: linked.email, created: false };
      }
    }
    const byEmail = await tx.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (byEmail) {
      if (byEmail.deleted_at || byEmail.fellowship_id !== member.fellowship_id) {
        throw new ConflictException(
          `The e-mail ${email} belongs to an account that cannot be used for this member. Use a different e-mail on the member record.`,
        );
      }
      const linkedElsewhere = await tx.member.findFirst({
        where: { user_id: byEmail.id, id: { not: member.id } },
        select: { id: true },
      });
      if (linkedElsewhere)
        throw new ConflictException(`The e-mail ${email} is already the login of another member.`);
      await tx.member.update({ where: { id: member.id }, data: { user_id: byEmail.id } });
      return { userId: byEmail.id, email: byEmail.email, created: false };
    }
    const { first, last } = splitName(member.full_name);
    const created = await tx.user.create({
      data: {
        email,
        password_hash: initialHash,
        first_name: first,
        last_name: last,
        phone: member.phone,
        gender: member.gender,
        roles: [role],
        permissions: permissionsFor([role]),
        department_id: departmentId,
        fellowship_id: member.fellowship_id,
        is_active: true,
        must_change_password: true,
      },
    });
    await tx.member.update({ where: { id: member.id }, data: { user_id: created.id } });
    return { userId: created.id, email: created.email, created: true };
  }

  /**
   * Makes an account's department-leader roles match its current appointments. An account left with no role at
   * all (an ordinary member, who must not have a login) is deactivated and signed out; it is reactivated - with its
   * own password - if the person is appointed again.
   */
  private async syncAccountRoles(tx: Tx, userId: string): Promise<void> {
    const account = await tx.user.findUnique({ where: { id: userId } });
    if (!account) return;
    const active = await tx.departmentLeader.findMany({
      where: { user_id: userId, active_role: { not: null } },
      orderBy: { start_date: 'asc' },
      select: { active_role: true, department_id: true },
    });
    const held = Array.from(new Set(active.map((a) => a.active_role as string)));
    const others = (account.roles || []).filter(
      (r) => !(LEADER_ROLES as readonly string[]).includes(r) && r !== 'ordinary_member',
    );
    const roles = [...others, ...held];
    const hasAccess = roles.length > 0;
    const finalRoles = hasAccess ? roles : ['ordinary_member'];
    const departmentId = active[0]?.department_id ?? null;
    const changed =
      JSON.stringify([...(account.roles || [])].sort()) !==
        JSON.stringify([...finalRoles].sort()) ||
      account.department_id !== departmentId ||
      account.is_active !== hasAccess;
    if (!changed) return;
    await tx.user.update({
      where: { id: userId },
      data: {
        roles: finalRoles,
        permissions: permissionsFor(finalRoles),
        department_id: departmentId,
        is_active: hasAccess,
        // Losing every role ends all of the account's sessions at once.
        ...(hasAccess ? {} : { token_version: { increment: 1 } }),
      },
    });
  }
}
