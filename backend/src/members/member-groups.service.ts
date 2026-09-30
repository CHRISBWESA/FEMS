import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

const MAX_BULK_MEMBERS = 200;

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
    const trimmed = name.trim();
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
    return description.trim();
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
      include: { _count: { select: { members: true } } },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isActive: g.is_active,
      memberCount: g._count.members,
      createdAt: g.created_at,
    }));
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_VIEW);
    const group = await this.loadGroup(id, currentUser);
    const memberships = await this.prisma.memberGroupMember.findMany({
      where: { group_id: id },
      include: { member: { select: { id: true, full_name: true, member_code: true, membership_status: true } } },
      orderBy: { joined_at: 'asc' },
    });
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      isActive: group.is_active,
      members: memberships.map((m) => ({
        memberId: m.member_id,
        fullName: m.member.full_name,
        memberCode: m.member.member_code,
        status: m.member.membership_status,
        joinedAt: m.joined_at,
      })),
    };
  }

  private async assertNameFree(fellowshipId: string | null, name: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.memberGroup.findFirst({
      where: { fellowship_id: fellowshipId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException('A group with this name already exists');
    }
  }

  async create(dto: CreateMemberGroupDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const name = this.validateName(dto.name);
    const description = this.validateDescription(dto.description);
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, dto.fellowshipId);
    await this.assertNameFree(fellowshipId, name);

    const group = await this.prisma.memberGroup.create({
      data: {
        name,
        description,
        is_active: dto.isActive ?? true,
        created_by: currentUser.userId,
        fellowship_id: fellowshipId,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.create',
      entityType: 'member_group',
      entityId: group.id,
      newValue: { name },
    });

    return { id: group.id, name: group.name, description: group.description, isActive: group.is_active };
  }

  async update(id: string, dto: UpdateMemberGroupDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const group = await this.loadGroup(id, currentUser);

    const changes: Record<string, any> = {};
    if (dto.name !== undefined) {
      changes.name = this.validateName(dto.name);
      await this.assertNameFree(group.fellowship_id, changes.name, id);
    }
    if (dto.description !== undefined) changes.description = this.validateDescription(dto.description);
    if (dto.isActive !== undefined) changes.is_active = !!dto.isActive;

    const updated = await this.prisma.memberGroup.update({ where: { id }, data: changes });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.edit',
      entityType: 'member_group',
      entityId: id,
      oldValue: { name: group.name, is_active: group.is_active },
      newValue: { name: updated.name, is_active: updated.is_active },
    });

    return { id: updated.id, name: updated.name, description: updated.description, isActive: updated.is_active };
  }

  async addMembers(
    id: string,
    memberIds: unknown,
    currentUser: any,
  ): Promise<{ added: number; alreadyMember: number; rejected: string[] }> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    const group = await this.loadGroup(id, currentUser);

    if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > MAX_BULK_MEMBERS) {
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
      newValue: { addedMemberIds: toAdd, alreadyMember: existingIds.size, rejected: rejected.length },
    });

    return { added: toAdd.length, alreadyMember: existingIds.size, rejected };
  }

  async removeMember(id: string, memberId: string, currentUser: any): Promise<{ message: string }> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_GROUPS_MANAGE);
    await this.loadGroup(id, currentUser);
    if (!isUuid(memberId)) {
      throw new NotFoundException('Member is not in this group');
    }

    const result = await this.prisma.memberGroupMember.deleteMany({ where: { group_id: id, member_id: memberId } });
    if (result.count === 0) {
      throw new NotFoundException('Member is not in this group');
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member_group.member_remove',
      entityType: 'member_group',
      entityId: id,
      oldValue: { memberId },
    });

    return { message: 'Member removed from group' };
  }
}
