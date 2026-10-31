import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { buildHistoryData } from '../members/membership-history.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { genderOf, parsePaging, toCsv } from './department.util';

const MAX_ADD = 200;
const MEMBER_FIELDS = {
  id: true,
  full_name: true,
  member_code: true,
  gender: true,
  email: true,
  phone: true,
  membership_status: true,
  programme: true,
  year_of_study: true,
} as const;

function memberFilters(q: any): Prisma.MemberWhereInput {
  const where: Prisma.MemberWhereInput = {};
  const search = validateText('search', q?.search, 100);
  if (search) {
    where.OR = [
      { full_name: { contains: search, mode: 'insensitive' } },
      { member_code: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  if (q?.gender) {
    if (!['male', 'female', 'other'].includes(String(q.gender)))
      throw new BadRequestException('gender must be male, female or other');
    where.gender = { equals: String(q.gender), mode: 'insensitive' };
  }
  if (q?.status) {
    if (!['active', 'inactive', 'graduated'].includes(String(q.status)))
      throw new BadRequestException('status must be active, inactive or graduated');
    where.membership_status = q.status;
  }
  return where;
}

/**
 * Department membership, managed by the department's own leaders. Members always come from the fellowship's
 * central register: nothing here creates, edits or deletes a member record, and leaving a department touches only
 * that one membership.
 */
@Injectable()
export class DepartmentMembersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
  ) {}

  async list(user: any, departmentId: string, q: any) {
    await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.DepartmentMemberWhereInput = {
      department_id: departmentId,
      removed: false,
      member: memberFilters(q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.departmentMember.findMany({
        where,
        include: { member: { select: MEMBER_FIELDS } },
        orderBy: { member: { full_name: 'asc' } },
        skip,
        take,
      }),
      this.prisma.departmentMember.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...this.shape(r.member), joinedAt: r.joined_at })),
      total,
      page,
      limit,
    };
  }

  private shape(m: any) {
    return {
      id: m.id,
      fullName: m.full_name,
      memberCode: m.member_code,
      gender: m.gender,
      email: m.email,
      phone: m.phone,
      status: m.membership_status,
      programme: m.programme,
      yearOfStudy: m.year_of_study,
    };
  }

  async detail(user: any, departmentId: string, memberId: string) {
    await this.access.assertLeader(user, departmentId);
    if (!isUuid(memberId)) throw new NotFoundException('Member not found');
    const row = await this.prisma.departmentMember.findFirst({
      where: { department_id: departmentId, member_id: memberId, removed: false },
      include: {
        member: {
          select: {
            ...MEMBER_FIELDS,
            university: true,
            created_at: true,
            departmentMemberships: {
              where: { removed: false },
              select: { department: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('This member is not in your department.');
    return {
      ...this.shape(row.member),
      university: (row.member as any).university,
      joinedAt: row.joined_at,
      departments: (row.member as any).departmentMemberships.map((d: any) => d.department),
    };
  }

  async stats(user: any, departmentId: string) {
    await this.access.assertLeader(user, departmentId);
    return this.computeStats(departmentId);
  }

  async computeStats(departmentId: string) {
    const rows = await this.prisma.departmentMember.findMany({
      where: { department_id: departmentId, removed: false },
      select: { member: { select: { gender: true, membership_status: true } } },
    });
    const by = (fn: (m: any) => boolean) => rows.filter((r) => fn(r.member)).length;
    return {
      total: rows.length,
      male: by((m) => genderOf(m.gender) === 'male'),
      female: by((m) => genderOf(m.gender) === 'female'),
      otherOrUnknown: by((m) => !genderOf(m.gender)),
      active: by((m) => m.membership_status === 'active'),
      inactive: by((m) => m.membership_status === 'inactive'),
      graduated: by((m) => m.membership_status === 'graduated'),
    };
  }

  /** Registered fellowship members to choose from; `inDepartment` marks those who already belong. */
  async candidates(user: any, departmentId: string, q: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit, 50);
    const where: Prisma.MemberWhereInput = {
      AND: [{ fellowship_id: department.fellowship_id }, memberFilters(q)],
    };
    const [rows, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        select: {
          ...MEMBER_FIELDS,
          departmentMemberships: {
            where: { department_id: departmentId, removed: false },
            select: { id: true },
          },
        },
        orderBy: { full_name: 'asc' },
        skip,
        take,
      }),
      this.prisma.member.count({ where }),
    ]);
    return {
      data: rows.map((m) => ({
        ...this.shape(m),
        inDepartment: m.departmentMemberships.length > 0,
      })),
      total,
      page,
      limit,
    };
  }

  async add(user: any, departmentId: string, body: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const ids = body?.memberIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ADD || !ids.every(isUuid)) {
      throw new BadRequestException(`memberIds must be a list of 1-${MAX_ADD} member ids`);
    }
    const requested = Array.from(new Set(ids as string[]));
    const found = await this.prisma.member.findMany({
      where: { id: { in: requested }, fellowship_id: department.fellowship_id },
      select: { id: true, full_name: true },
    });
    const valid = new Set(found.map((m) => m.id));
    const rejected = requested.filter((id) => !valid.has(id));

    const existing = await this.prisma.departmentMember.findMany({
      where: { department_id: departmentId, member_id: { in: [...valid] } },
    });
    const activeIds = new Set(existing.filter((e) => !e.removed).map((e) => e.member_id));
    const reactivate = existing.filter((e) => e.removed).map((e) => e.id);
    const toCreate = [...valid].filter((id) => !existing.some((e) => e.member_id === id));
    const added = [...valid].filter((id) => !activeIds.has(id));

    if (added.length) {
      await this.prisma.$transaction(async (tx) => {
        if (reactivate.length)
          await tx.departmentMember.updateMany({
            where: { id: { in: reactivate } },
            data: { removed: false, removed_at: null, joined_at: new Date() },
          });
        if (toCreate.length)
          await tx.departmentMember.createMany({
            data: toCreate.map((member_id) => ({ department_id: departmentId, member_id })),
            skipDuplicates: true,
          });
        await tx.membershipHistory.createMany({
          data: added.map((memberId) =>
            buildHistoryData({
              memberId,
              fellowshipId: department.fellowship_id,
              eventType: 'department_joined',
              departmentId,
              recordedBy: user.userId,
            }),
          ),
        });
      });
      await this.audit.log({
        userId: user.userId,
        action: 'department.members_add',
        entityType: 'department',
        entityId: departmentId,
        newValue: { memberIds: added },
      });
      const names = found.filter((m) => added.includes(m.id)).map((m) => m.full_name);
      await this.notifier.notify(
        await this.access.currentLeaderUserIds(departmentId),
        {
          eventType: 'department_members_added',
          title: 'Members added',
          message: `${names.length === 1 ? names[0] : `${names.length} members`} added to ${department.name}.`,
          entityType: 'department',
          entityId: departmentId,
          fellowshipId: department.fellowship_id,
        },
        user.userId,
      );
    }
    return { added: added.length, alreadyMember: activeIds.size, rejected };
  }

  async remove(user: any, departmentId: string, memberId: string, body: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    if (!isUuid(memberId)) throw new NotFoundException('Member not found');
    const reason = validateText('reason', body?.reason, 300);
    const row = await this.prisma.departmentMember.findFirst({
      where: { department_id: departmentId, member_id: memberId, removed: false },
      include: { member: { select: { full_name: true } } },
    });
    if (!row) throw new NotFoundException('This member is not in your department.');
    const leads = await this.prisma.departmentLeader.findFirst({
      where: { department_id: departmentId, member_id: memberId, active_role: { not: null } },
    });
    if (leads)
      throw new BadRequestException(
        'A current leader of the department cannot be removed from it. The Fellowship Secretary must appoint someone else first.',
      );
    await this.prisma.$transaction(async (tx) => {
      // Only this membership changes: the member record and their other departments are untouched.
      await tx.departmentMember.update({
        where: { id: row.id },
        data: { removed: true, removed_at: new Date() },
      });
      await tx.membershipHistory.create({
        data: buildHistoryData({
          memberId,
          fellowshipId: department.fellowship_id,
          eventType: 'department_removed',
          departmentId,
          reason,
          recordedBy: user.userId,
        }),
      });
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department.member_remove',
      entityType: 'department',
      entityId: departmentId,
      oldValue: { memberId },
      comment: reason || undefined,
    });
    await this.notifier.notify(
      await this.access.currentLeaderUserIds(departmentId),
      {
        eventType: 'department_member_removed',
        title: 'Member removed',
        message: `${row.member.full_name} was removed from ${department.name}.`,
        entityType: 'department',
        entityId: departmentId,
        fellowshipId: department.fellowship_id,
      },
      user.userId,
    );
    return { message: `${row.member.full_name} removed from ${department.name}` };
  }

  async exportCsv(
    user: any,
    departmentId: string,
    q: any,
  ): Promise<{ filename: string; csv: string }> {
    const { department } = await this.access.assertLeader(user, departmentId);
    const rows = await this.prisma.departmentMember.findMany({
      where: { department_id: departmentId, removed: false, member: memberFilters(q) },
      include: { member: { select: MEMBER_FIELDS } },
      orderBy: { member: { full_name: 'asc' } },
      take: 5000,
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department.members_export',
      entityType: 'department',
      entityId: departmentId,
      newValue: { count: rows.length },
    });
    return {
      filename: `${department.name}-members.csv`,
      csv: toCsv(
        [
          'Name',
          'Member code',
          'Gender',
          'Status',
          'E-mail',
          'Phone',
          'Programme',
          'Year of study',
          'Joined department',
        ],
        rows.map((r) => [
          r.member.full_name,
          r.member.member_code,
          r.member.gender,
          r.member.membership_status,
          r.member.email,
          r.member.phone,
          r.member.programme,
          r.member.year_of_study,
          r.joined_at.toISOString().slice(0, 10),
        ]),
      ),
    };
  }
}
