import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { MemberAccessService } from './member-access.service';
import { isUuid } from './member.util';

export interface CreateMemberGroupDto {
  name: string;
  description?: string;
  isActive?: boolean;
  fellowshipId?: string;
}

export type UpdateMemberGroupDto = Partial<CreateMemberGroupDto>;

/** `null` clears the role, a member id appoints that member, and leaving the key out keeps the current holder. */
export interface SetGroupLeadersDto {
  maleLeaderId?: string | null;
  femaleLeaderId?: string | null;
}

const MAX_BULK_MEMBERS = 200;

export const GROUP_LEADER_ROLES = { male: 'male_leader', female: 'female_leader' } as const;
export type LeaderGender = keyof typeof GROUP_LEADER_ROLES;

/** The member's recorded gender as 'male' / 'female', or null for anything else. Never changes the record. */
export function leaderGenderOf(gender: unknown): LeaderGender | null {
  const g = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
  return g === 'male' || g === 'female' ? g : null;
}

type LeaderRow = {
  leader_role: string | null;
  member: { id: string; full_name: string; member_code: string };
};
type LeaderSummary = { memberId: string; fullName: string; memberCode: string } | null;

function leaderFrom(rows: LeaderRow[], role: string): LeaderSummary {
  const row = rows.find((r) => r.leader_role === role);
  return row
    ? {
        memberId: row.member.id,
        fullName: row.member.full_name,
        memberCode: row.member.member_code,
      }
    : null;
}

function rethrowUnique(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw e;
}

@Injectable()
export class MemberGroupsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: MemberAccessService,
  ) {}

  private validateName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 80) {
      throw new BadRequestException('name must be at most 80 characters');
    }
    return trimmed;
  }

  private validateDescription(description: unknown): string | null {
    if (description === undefined || description === null || description === '') return null;
    if (typeof description !== 'string' || description.length > 300) {
      throw new BadRequestException('description must be a string of at most 300 characters');
    }
    return description.trim() || null;
  }

  private async loadGroup(id: string, currentUser: any): Promise<any> {
    if (!isUuid(id)) {
      throw new NotFoundException('Group not found');
    }
    const group = await this.prisma.memberGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    this.tenantScope.assertInScope(currentUser, group);
    return group;
  }

  async findAll(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_VIEW);
    const where = this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId);
    const groups = await this.prisma.memberGroup.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { members: true } },
        members: {
          where: { leader_role: { not: null } },
          select: {
            leader_role: true,
            member: { select: { id: true, full_name: true, member_code: true } },
          },
        },
      },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isActive: g.is_active,
      memberCount: g._count.members,
      maleLeader: leaderFrom(g.members, GROUP_LEADER_ROLES.male),
      femaleLeader: leaderFrom(g.members, GROUP_LEADER_ROLES.female),
      createdAt: g.created_at,
    }));
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_VIEW);
    const group = await this.loadGroup(id, currentUser);
    const memberships = await this.prisma.memberGroupMember.findMany({
      where: { group_id: id },
      include: {
        member: {
          select: {
            id: true,
            full_name: true,
            member_code: true,
            membership_status: true,
            gender: true,
          },
        },
      },
      orderBy: { joined_at: 'asc' },
    });
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      isActive: group.is_active,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
      memberCount: memberships.length,
      maleLeader: leaderFrom(memberships, GROUP_LEADER_ROLES.male),
      femaleLeader: leaderFrom(memberships, GROUP_LEADER_ROLES.female),
      members: memberships.map((m) => ({
        memberId: m.member_id,
        fullName: m.member.full_name,
        memberCode: m.member.member_code,
        status: m.member.membership_status,
        gender: m.member.gender,
        leaderRole: m.leader_role,
        joinedAt: m.joined_at,
      })),
    };
  }

  private async assertNameFree(
    fellowshipId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    // Case-insensitive: "Youth Cell" and "youth cell" would be the same group to the people using it.
    const clash = await this.prisma.memberGroup.findFirst({
      where: {
        fellowship_id: fellowshipId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException('A group with this name already exists');
    }
  }

  async create(dto: CreateMemberGroupDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const name = this.validateName(dto?.name);
    const description = this.validateDescription(dto?.description);
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, dto?.fellowshipId);
    await this.assertNameFree(fellowshipId, name);

    const group = await this.prisma.memberGroup
      .create({
        data: {
          name,
          description,
          is_active: dto.isActive ?? true,
          created_by: currentUser.userId,
          fellowship_id: fellowshipId,
        },
      })
      .catch((e) => rethrowUnique(e, 'A group with this name already exists'));

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.create',
      entityType: 'member_group',
      entityId: group.id,
      newValue: { name, description },
    });

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      isActive: group.is_active,
    };
  }

  async update(id: string, dto: UpdateMemberGroupDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const group = await this.loadGroup(id, currentUser);

    const changes: Record<string, any> = {};
    if (dto?.name !== undefined) {
      changes.name = this.validateName(dto.name);
      await this.assertNameFree(group.fellowship_id, changes.name, id);
    }
    if (dto?.description !== undefined)
      changes.description = this.validateDescription(dto.description);
    if (dto?.isActive !== undefined) changes.is_active = !!dto.isActive;

    const updated = await this.prisma.memberGroup
      .update({ where: { id }, data: changes })
      .catch((e) => rethrowUnique(e, 'A group with this name already exists'));

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.edit',
      entityType: 'member_group',
      entityId: id,
      oldValue: { name: group.name, description: group.description, is_active: group.is_active },
      newValue: {
        name: updated.name,
        description: updated.description,
        is_active: updated.is_active,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isActive: updated.is_active,
    };
  }

  async addMembers(
    id: string,
    memberIds: unknown,
    currentUser: any,
  ): Promise<{ added: number; alreadyMember: number; rejected: string[] }> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const group = await this.loadGroup(id, currentUser);

    if (
      !Array.isArray(memberIds) ||
      memberIds.length === 0 ||
      memberIds.length > MAX_BULK_MEMBERS
    ) {
      throw new BadRequestException(`memberIds must be an array of 1-${MAX_BULK_MEMBERS} ids`);
    }
    if (!memberIds.every(isUuid)) {
      throw new BadRequestException('memberIds must contain valid ids');
    }
    const requested = Array.from(new Set(memberIds as string[]));

    // A member must belong to the same fellowship as the group. Anything else (missing, other
    // fellowship, out of the caller's scope) is reported the same way so ids can't be probed.
    const found = await this.prisma.member.findMany({
      where: this.tenantScope.scopeWhere(currentUser, { id: { in: requested } }),
      select: { id: true, fellowship_id: true },
    });
    const valid = found.filter((m) => m.fellowship_id === group.fellowship_id).map((m) => m.id);
    const rejected = requested.filter((rid) => !valid.includes(rid));

    const existing = valid.length
      ? await this.prisma.memberGroupMember.findMany({
          where: { group_id: id, member_id: { in: valid } },
          select: { member_id: true },
        })
      : [];
    const existingIds = new Set(existing.map((e) => e.member_id));
    const toAdd = valid.filter((mid) => !existingIds.has(mid));

    if (toAdd.length > 0) {
      // skipDuplicates plus the (group_id, member_id) unique index: a concurrent add can never double a membership.
      await this.prisma.memberGroupMember.createMany({
        data: toAdd.map((mid) => ({
          group_id: id,
          member_id: mid,
          fellowship_id: group.fellowship_id,
          added_by: currentUser.userId,
        })),
        skipDuplicates: true,
      });
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.members_add',
      entityType: 'member_group',
      entityId: id,
      newValue: {
        addedMemberIds: toAdd,
        alreadyMember: existingIds.size,
        rejected: rejected.length,
      },
    });

    return { added: toAdd.length, alreadyMember: existingIds.size, rejected };
  }

  async removeMember(id: string, memberId: string, currentUser: any): Promise<{ message: string }> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    await this.loadGroup(id, currentUser);
    if (!isUuid(memberId)) {
      throw new NotFoundException('Member is not in this group');
    }

    const membership = await this.prisma.memberGroupMember.findUnique({
      where: { group_id_member_id: { group_id: id, member_id: memberId } },
      select: { leader_role: true },
    });
    // Leadership lives on the membership row, so deleting the row also clears it.
    const result = await this.prisma.memberGroupMember.deleteMany({
      where: { group_id: id, member_id: memberId },
    });
    if (!membership || result.count === 0) {
      throw new NotFoundException('Member is not in this group');
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.member_remove',
      entityType: 'member_group',
      entityId: id,
      oldValue: { memberId, leaderRole: membership.leader_role },
    });

    return {
      message: membership.leader_role
        ? 'Member removed from group. Their leadership was cleared.'
        : 'Member removed from group',
    };
  }

  /**
   * Deletes a group (fellowships start new groups every year). Its memberships and leadership go with it; the
   * member records themselves are untouched. A full copy - the group, who was in it and who led it - is kept in the
   * recycle bin first, in the same transaction, so nothing is lost if the copy cannot be written.
   */
  async remove(
    id: string,
    currentUser: any,
  ): Promise<{ message: string; removedMemberships: number }> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const group = await this.loadGroup(id, currentUser);
    const memberships = await this.prisma.memberGroupMember.findMany({
      where: { group_id: id },
      select: { member_id: true, leader_role: true, joined_at: true, added_by: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.deletedRecord.create({
        data: {
          original_collection: 'member_group',
          original_record_id: id,
          original_data: JSON.parse(JSON.stringify({ group, members: memberships })),
          fellowship_id: group.fellowship_id,
          deleted_by: currentUser.userId,
          deleted_at: new Date(),
          restore_token: randomBytes(24).toString('hex'),
        },
      });
      // Memberships (and the leadership stored on them) cascade with the group.
      await tx.memberGroup.delete({ where: { id } });
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.delete',
      entityType: 'member_group',
      entityId: id,
      oldValue: {
        name: group.name,
        memberCount: memberships.length,
        leaders: memberships
          .filter((m) => m.leader_role)
          .map((m) => ({ memberId: m.member_id, role: m.leader_role })),
      },
    });

    return { message: `Group "${group.name}" deleted`, removedMemberships: memberships.length };
  }

  /**
   * Appoints, replaces or clears the male and/or female leader. A leader must already be in the group and their
   * recorded gender must match the role. Both changes are applied together or not at all.
   */
  async setLeaders(id: string, dto: SetGroupLeadersDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    await this.loadGroup(id, currentUser);

    const body: any = dto && typeof dto === 'object' ? dto : {};
    const wanted: { gender: LeaderGender; memberId: string | null }[] = [];
    for (const [gender, key] of [
      ['male', 'maleLeaderId'],
      ['female', 'femaleLeaderId'],
    ] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (value !== null && !isUuid(value))
        throw new BadRequestException(`${key} must be a member id or null`);
      wanted.push({ gender, memberId: value });
    }
    if (wanted.length === 0)
      throw new BadRequestException('Provide maleLeaderId and/or femaleLeaderId');
    if (wanted.length === 2 && wanted[0].memberId && wanted[0].memberId === wanted[1].memberId) {
      throw new BadRequestException('The same member cannot hold both leader roles');
    }

    const appointees = wanted.map((w) => w.memberId).filter((m): m is string => !!m);
    const rows = appointees.length
      ? await this.prisma.memberGroupMember.findMany({
          where: { group_id: id, member_id: { in: appointees } },
          include: { member: { select: { full_name: true, gender: true } } },
        })
      : [];
    for (const w of wanted) {
      if (!w.memberId) continue;
      const row = rows.find((r) => r.member_id === w.memberId);
      if (!row)
        throw new BadRequestException(
          `The ${w.gender} leader must already be a member of this group`,
        );
      if (leaderGenderOf(row.member.gender) !== w.gender) {
        throw new BadRequestException(
          `${row.member.full_name} is not recorded as ${w.gender}, so cannot be the ${w.gender} leader`,
        );
      }
    }

    const leadersNow = () =>
      this.prisma.memberGroupMember.findMany({
        where: { group_id: id, leader_role: { not: null } },
        select: { member_id: true, leader_role: true },
      });
    const before = await leadersNow();

    await this.prisma
      .$transaction(async (tx) => {
        for (const w of wanted) {
          const role = GROUP_LEADER_ROLES[w.gender];
          // Clear the current holder first so the (group, role) unique index never sees two holders.
          await tx.memberGroupMember.updateMany({
            where: { group_id: id, leader_role: role },
            data: { leader_role: null },
          });
          if (w.memberId) {
            const res = await tx.memberGroupMember.updateMany({
              where: { group_id: id, member_id: w.memberId },
              data: { leader_role: role },
            });
            // Removed from the group between the check above and now.
            if (res.count === 0)
              throw new BadRequestException(
                `The ${w.gender} leader must already be a member of this group`,
              );
          }
        }
      })
      .catch((e) =>
        rethrowUnique(e, 'The group leaders were changed at the same time. Please try again.'),
      );

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.leaders_set',
      entityType: 'member_group',
      entityId: id,
      oldValue: { leaders: before },
      newValue: { leaders: await leadersNow() },
    });

    return this.findOne(id, currentUser);
  }
}

/**
 * Called after a member's gender changes: any group leadership that no longer matches the recorded gender is
 * cleared, so a group can never show a "male leader" whose record says otherwise. Returns the cleared rows.
 */
export async function clearMismatchedGroupLeadership(
  db: { memberGroupMember: Prisma.TransactionClient['memberGroupMember'] },
  memberId: string,
  gender: unknown,
): Promise<{ group_id: string; leader_role: string | null }[]> {
  const keep = leaderGenderOf(gender);
  const keepRole = keep ? GROUP_LEADER_ROLES[keep] : null;
  const mismatched = await db.memberGroupMember.findMany({
    where: {
      member_id: memberId,
      leader_role: keepRole ? { not: null, notIn: [keepRole] } : { not: null },
    },
    select: { group_id: true, leader_role: true },
  });
  if (mismatched.length > 0) {
    await db.memberGroupMember.updateMany({
      where: { member_id: memberId, group_id: { in: mismatched.map((m) => m.group_id) } },
      data: { leader_role: null },
    });
  }
  return mismatched;
}
