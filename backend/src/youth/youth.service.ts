import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { listWindow, pageResult } from '../shared/utils/paging.util';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { computeAge } from './youth-age-groups.service';
import { isUuid } from '../shared/utils/uuid.util';

export interface CreateYouthProfileDto {
  fullName: string;
  dateOfBirth: string;
  gender?: string;
  departmentId?: string;
  memberId?: string;
  notes?: string;
  fellowshipId?: string;
}

export type UpdateYouthProfileDto = Partial<CreateYouthProfileDto>;

export interface ChangeYouthStatusDto {
  status: 'active' | 'inactive' | 'graduated';
}

export interface AddGuardianDto {
  guardianMemberId: string;
  relationshipType: string;
  isPrimary?: boolean;
  consentStatus?: string;
}

export interface RecordYouthAttendanceDto {
  activityId: string;
}

const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];

@Injectable()
export class YouthService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
  ) {}

  private isDepartmentLeader(currentUser: any): boolean {
    const roles: string[] = currentUser.roles || [];
    return DEPARTMENT_LEADER_ROLES.some((r) => roles.includes(r));
  }

  private hasPermission(currentUser: any, permission: string): boolean {
    const permissions: string[] = currentUser.permissions || [];
    return permissions.includes(permission);
  }

  // Strips sensitive fields (DOB/age/gender, safeguarding notes) for callers without the
  // matching youth.* permission. This is the first field-level ACL in this codebase (everything
  // else gates at the endpoint/query level) - introduced specifically for Youth's privacy
  // requirement rather than generalized, per the module's documented scope.
  private serialize(profile: any, currentUser: any): any {
    const result: any = {
      id: profile.id,
      fullName: profile.full_name,
      status: profile.status,
      ageGroupId: profile.age_group_id,
      ageGroup: profile.ageGroup ?? undefined,
      departmentId: profile.department_id,
      memberId: profile.member_id,
      fellowshipId: profile.fellowship_id,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };

    if (this.hasPermission(currentUser, PERMISSIONS.YOUTH_DETAILS_VIEW)) {
      result.dateOfBirth = profile.date_of_birth;
      result.age = computeAge(profile.date_of_birth);
      result.gender = profile.gender;
    }

    if (this.hasPermission(currentUser, PERMISSIONS.YOUTH_SAFEGUARDING_VIEW)) {
      result.notes = profile.notes;
    }

    return result;
  }

  private async resolveAgeGroupId(
    currentUser: any,
    fellowshipId: string | null,
    dateOfBirth: Date,
  ): Promise<string | null> {
    const age = computeAge(dateOfBirth);
    const where = this.tenantScope.scopeWhere(currentUser, { is_active: true }, fellowshipId ?? undefined) as any;
    const ageGroups = await this.prisma.ageGroup.findMany({ where });
    const match = ageGroups.find((g) => age >= g.min_age && age <= g.max_age);
    return match?.id ?? null;
  }

  async findAll(currentUser: any, queryFellowshipId?: string, filters?: { ageGroupId?: string; status?: string; departmentId?: string }, page?: unknown, limit?: unknown): Promise<{ data: any[]; total: number }> {
    let where: Prisma.YouthProfileWhereInput = {};
    this.assertOptionalUuid(filters?.ageGroupId, 'ageGroupId');
    this.assertOptionalUuid(filters?.departmentId, 'departmentId');
    this.assertOptionalUuid(queryFellowshipId, 'fellowshipId');

    if (this.isDepartmentLeader(currentUser)) {
      if (!currentUser.departmentId) {
        return { data: [], total: 0 };
      }
      where.department_id = currentUser.departmentId;
    } else if (filters?.departmentId) {
      where.department_id = filters.departmentId;
    }

    if (filters?.ageGroupId) where.age_group_id = filters.ageGroupId;
    if (filters?.status) where.status = filters.status as any;

    where = this.tenantScope.scopeWhere(currentUser, where, queryFellowshipId) as Prisma.YouthProfileWhereInput;

    const w = listWindow(page, limit);
    const profiles = await this.prisma.youthProfile.findMany({
      where,
      include: { ageGroup: true },
      orderBy: [{ full_name: 'asc' }, { id: 'asc' }],
      skip: w.skip,
      take: w.take,
    });

    const result = await pageResult(profiles, w, () => this.prisma.youthProfile.count({ where }));
    return { data: result.data.map((p) => this.serialize(p, currentUser)), total: result.total };
  }

  private assertOptionalUuid(value: unknown, label: string): void {
    if (value !== undefined && value !== null && value !== '' && !isUuid(value)) {
      throw new BadRequestException(`${label} must be a valid id`);
    }
  }

  private async findOneRaw(id: string, currentUser: any): Promise<any> {
    if (!isUuid(id)) {
      throw new NotFoundException('Youth/child participant not found');
    }
    const profile = await this.prisma.youthProfile.findUnique({
      where: { id },
      include: { ageGroup: true },
    });
    if (!profile) {
      throw new NotFoundException('Youth/child participant not found');
    }
    this.tenantScope.assertInScope(currentUser, profile);

    if (this.isDepartmentLeader(currentUser) && profile.department_id !== currentUser.departmentId) {
      throw new ForbiddenException('You can only access participants in your own department.');
    }

    return profile;
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    const profile = await this.findOneRaw(id, currentUser);
    return this.serialize(profile, currentUser);
  }

  async create(data: CreateYouthProfileDto, currentUser: any): Promise<any> {
    if (!data.fullName || !data.dateOfBirth) {
      throw new BadRequestException('fullName and dateOfBirth are required');
    }

    this.assertOptionalUuid(data.departmentId, 'departmentId');
    this.assertOptionalUuid(data.memberId, 'memberId');
    this.assertOptionalUuid(data.fellowshipId, 'fellowshipId');

    const dateOfBirth = new Date(data.dateOfBirth);
    if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
      throw new BadRequestException('dateOfBirth must be a valid date in the past');
    }

    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, data.fellowshipId);

    if (data.departmentId) {
      const department = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) throw new NotFoundException('Department not found');
      this.tenantScope.assertInScope(currentUser, department, fellowshipId ?? undefined);
    }

    if (data.memberId) {
      const member = await this.prisma.member.findUnique({ where: { id: data.memberId } });
      if (!member) throw new NotFoundException('Member not found');
      this.tenantScope.assertInScope(currentUser, member, fellowshipId ?? undefined);
      const existingLink = await this.prisma.youthProfile.findUnique({ where: { member_id: data.memberId } });
      if (existingLink) throw new BadRequestException('This member is already linked to a youth/child profile');
    }

    const ageGroupId = await this.resolveAgeGroupId(currentUser, fellowshipId, dateOfBirth);

    const profile = await this.prisma.youthProfile.create({
      data: {
        full_name: data.fullName,
        date_of_birth: dateOfBirth,
        gender: data.gender,
        department_id: data.departmentId,
        member_id: data.memberId,
        age_group_id: ageGroupId,
        notes: data.notes,
        created_by: currentUser.userId,
        fellowship_id: fellowshipId,
      },
      include: { ageGroup: true },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.create',
      entityType: 'youth_profile',
      entityId: profile.id,
      newValue: { fullName: data.fullName, departmentId: data.departmentId },
    });

    return this.serialize(profile, currentUser);
  }

  async update(id: string, data: UpdateYouthProfileDto, currentUser: any): Promise<any> {
    const profile = await this.findOneRaw(id, currentUser);
    this.assertOptionalUuid(data.departmentId, 'departmentId');
    this.assertOptionalUuid(data.memberId, 'memberId');

    if (data.departmentId) {
      const department = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) throw new NotFoundException('Department not found');
      this.tenantScope.assertInScope(currentUser, department);
    }

    if (data.memberId) {
      const member = await this.prisma.member.findUnique({ where: { id: data.memberId } });
      if (!member) throw new NotFoundException('Member not found');
      this.tenantScope.assertInScope(currentUser, member);
    }

    const changes: Record<string, any> = {};
    if (data.fullName !== undefined) changes.full_name = data.fullName;
    if (data.gender !== undefined) changes.gender = data.gender;
    if (data.notes !== undefined) changes.notes = data.notes;
    if (data.departmentId !== undefined) changes.department_id = data.departmentId;
    if (data.memberId !== undefined) changes.member_id = data.memberId;

    if (data.dateOfBirth !== undefined) {
      const dateOfBirth = new Date(data.dateOfBirth);
      if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
        throw new BadRequestException('dateOfBirth must be a valid date in the past');
      }
      changes.date_of_birth = dateOfBirth;
      changes.age_group_id = await this.resolveAgeGroupId(currentUser, profile.fellowship_id, dateOfBirth);
    }

    const updated = await this.prisma.youthProfile.update({
      where: { id },
      data: changes as any,
      include: { ageGroup: true },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.edit',
      entityType: 'youth_profile',
      entityId: id,
      oldValue: { full_name: profile.full_name, department_id: profile.department_id },
      newValue: { full_name: updated.full_name, department_id: updated.department_id },
    });

    return this.serialize(updated, currentUser);
  }

  async changeStatus(id: string, dto: ChangeYouthStatusDto, currentUser: any): Promise<any> {
    const profile = await this.findOneRaw(id, currentUser);

    const updated = await this.prisma.youthProfile.update({
      where: { id },
      data: { status: dto.status as any },
      include: { ageGroup: true },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.status_change',
      entityType: 'youth_profile',
      entityId: id,
      oldValue: { status: profile.status },
      newValue: { status: updated.status },
    });

    return this.serialize(updated, currentUser);
  }

  // ---------- Guardians ----------

  async listGuardians(youthId: string, currentUser: any): Promise<any[]> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_GUARDIANS_VIEW)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    await this.findOneRaw(youthId, currentUser);

    const guardians = await this.prisma.youthGuardian.findMany({
      where: { youth_id: youthId },
      include: { guardianMember: { select: { id: true, full_name: true, phone: true, email: true } } },
      orderBy: { is_primary: 'desc' },
    });
    return guardians;
  }

  async addGuardian(youthId: string, dto: AddGuardianDto, currentUser: any): Promise<any> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_GUARDIANS_MANAGE)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const profile = await this.findOneRaw(youthId, currentUser);

    if (!dto.guardianMemberId || !dto.relationshipType) {
      throw new BadRequestException('guardianMemberId and relationshipType are required');
    }
    this.assertOptionalUuid(dto.guardianMemberId, 'guardianMemberId');

    const guardianMember = await this.prisma.member.findUnique({ where: { id: dto.guardianMemberId } });
    if (!guardianMember) {
      throw new NotFoundException('Guardian member not found');
    }
    // Cross-tenant prevention: the guardian must belong to the same fellowship as the youth
    // profile, mirroring TenantScopeService.assertInScope rather than the requester's own scope
    // (an admin acting across fellowships must still not link mismatched records together).
    if (guardianMember.fellowship_id !== profile.fellowship_id) {
      throw new ForbiddenException('Guardian must belong to the same fellowship as the participant');
    }

    const existing = await this.prisma.youthGuardian.findUnique({
      where: { youth_id_guardian_member_id: { youth_id: youthId, guardian_member_id: dto.guardianMemberId } },
    });
    if (existing) {
      throw new BadRequestException('This guardian relationship already exists');
    }

    const guardian = await this.prisma.youthGuardian.create({
      data: {
        youth_id: youthId,
        guardian_member_id: dto.guardianMemberId,
        relationship_type: dto.relationshipType,
        is_primary: dto.isPrimary ?? false,
        consent_status: dto.consentStatus ?? 'granted',
        created_by: currentUser.userId,
        fellowship_id: profile.fellowship_id,
      },
      include: { guardianMember: { select: { id: true, full_name: true, phone: true, email: true } } },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.guardian_add',
      entityType: 'youth_profile',
      entityId: youthId,
      newValue: { guardianMemberId: dto.guardianMemberId, relationshipType: dto.relationshipType },
    });

    return guardian;
  }

  async removeGuardian(youthId: string, guardianId: string, currentUser: any): Promise<{ message: string }> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_GUARDIANS_MANAGE)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    await this.findOneRaw(youthId, currentUser);
    if (!isUuid(guardianId)) {
      throw new NotFoundException('Guardian relationship not found');
    }

    const guardian = await this.prisma.youthGuardian.findUnique({ where: { id: guardianId } });
    if (!guardian || guardian.youth_id !== youthId) {
      throw new NotFoundException('Guardian relationship not found');
    }

    await this.prisma.youthGuardian.delete({ where: { id: guardianId } });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.guardian_remove',
      entityType: 'youth_profile',
      entityId: youthId,
      oldValue: { guardianMemberId: guardian.guardian_member_id },
    });

    return { message: 'Guardian relationship removed' };
  }

  // ---------- Attendance (reuses the existing Activity/Attendance tables) ----------

  async recordAttendance(youthId: string, dto: RecordYouthAttendanceDto, currentUser: any): Promise<any> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_ATTENDANCE_MANAGE)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const profile = await this.findOneRaw(youthId, currentUser);
    if (!isUuid(dto?.activityId)) {
      throw new BadRequestException('activityId must be a valid id');
    }

    const activity = await this.prisma.activity.findUnique({ where: { id: dto.activityId } });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    this.tenantScope.assertInScope(currentUser, activity);

    const attendance = await this.prisma.attendance.create({
      data: {
        activity_id: dto.activityId,
        youth_profile_id: youthId,
        recorded_by_name: profile.full_name,
        is_confirmed: true,
        fellowship_id: activity.fellowship_id,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.attendance_record',
      entityType: 'youth_profile',
      entityId: youthId,
      newValue: { activityId: dto.activityId },
    });

    return attendance;
  }

  async listAttendance(youthId: string, currentUser: any): Promise<any[]> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_ATTENDANCE_VIEW)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    await this.findOneRaw(youthId, currentUser);

    return this.prisma.attendance.findMany({
      where: { youth_profile_id: youthId },
      include: { activity: { select: { id: true, title: true, date: true } } },
      orderBy: { recorded_at: 'desc' },
    });
  }

  // ---------- Reports ----------

  async reportsSummary(currentUser: any, queryFellowshipId?: string): Promise<any> {
    if (!this.hasPermission(currentUser, PERMISSIONS.YOUTH_REPORTS_VIEW)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    this.assertOptionalUuid(queryFellowshipId, 'fellowshipId');
    let baseWhere: Prisma.YouthProfileWhereInput = {};
    if (this.isDepartmentLeader(currentUser)) {
      if (!currentUser.departmentId) {
        return { totalParticipants: 0, activeParticipants: 0, byAgeGroup: [], byStatus: [] };
      }
      baseWhere.department_id = currentUser.departmentId;
    }
    baseWhere = this.tenantScope.scopeWhere(currentUser, baseWhere, queryFellowshipId) as Prisma.YouthProfileWhereInput;

    // Aggregated in the database (no per-profile rows are loaded).
    const [totalParticipants, activeParticipants, statusRows, ageGroupRows, ageGroups] = await Promise.all([
      this.prisma.youthProfile.count({ where: baseWhere }),
      this.prisma.youthProfile.count({ where: { ...baseWhere, status: 'active' } }),
      this.prisma.youthProfile.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
      this.prisma.youthProfile.groupBy({ by: ['age_group_id'], where: baseWhere, _count: { _all: true } }),
      this.prisma.ageGroup.findMany({
        where: this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId) as any,
      }),
    ]);

    const byStatusMap = new Map<string, number>();
    const byAgeGroupMap = new Map<string, number>();
    for (const r of statusRows) byStatusMap.set(r.status, r._count._all);
    for (const r of ageGroupRows) byAgeGroupMap.set(r.age_group_id ?? 'unassigned', r._count._all);

    const ageGroupNameById = new Map(ageGroups.map((g) => [g.id, g.name]));

    return {
      totalParticipants,
      activeParticipants,
      byStatus: Array.from(byStatusMap.entries()).map(([status, count]) => ({ status, count })),
      byAgeGroup: Array.from(byAgeGroupMap.entries()).map(([ageGroupId, count]) => ({
        ageGroupId,
        ageGroupName: ageGroupId === 'unassigned' ? 'Unassigned' : ageGroupNameById.get(ageGroupId) || 'Unknown',
        count,
      })),
    };
  }
}
