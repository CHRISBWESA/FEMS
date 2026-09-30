import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';

export interface CreateAgeGroupDto {
  name: string;
  minAge: number;
  maxAge: number;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
  fellowshipId?: string;
}

export type UpdateAgeGroupDto = Partial<CreateAgeGroupDto>;

@Injectable()
export class YouthAgeGroupsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
  ) {}

  async findAll(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    if (queryFellowshipId !== undefined && queryFellowshipId !== '' && !isUuid(queryFellowshipId)) {
      throw new BadRequestException('fellowshipId must be a valid id');
    }
    const where = this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId);
    return this.prisma.ageGroup.findMany({
      where,
      orderBy: [{ display_order: 'asc' }, { min_age: 'asc' }],
    });
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    if (!isUuid(id)) {
      throw new NotFoundException('Age group not found');
    }
    const ageGroup = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!ageGroup) {
      throw new NotFoundException('Age group not found');
    }
    this.tenantScope.assertInScope(currentUser, ageGroup);
    return ageGroup;
  }

  // Non-overlapping ranges are enforced here (not as a DB constraint - Postgres exclusion
  // constraints aren't used elsewhere in this schema, so app-layer validation matches the
  // codebase's existing style). This keeps age-group -> participant resolution deterministic
  // for reporting (spec section 7 / section 21).
  private async assertNoOverlap(
    currentUser: any,
    fellowshipId: string | null,
    minAge: number,
    maxAge: number,
    excludeId?: string,
  ): Promise<void> {
    if (minAge > maxAge) {
      throw new BadRequestException('min_age must be less than or equal to max_age');
    }
    const where = this.tenantScope.scopeWhere(currentUser, {
      is_active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    }) as any;
    const existing = await this.prisma.ageGroup.findMany({ where });
    const overlaps = existing.some((g) => minAge <= g.max_age && maxAge >= g.min_age);
    if (overlaps) {
      throw new BadRequestException('Age group range overlaps an existing active age group');
    }
  }

  async create(data: CreateAgeGroupDto, currentUser: any): Promise<any> {
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, data.fellowshipId);
    await this.assertNoOverlap(currentUser, fellowshipId, data.minAge, data.maxAge);

    const ageGroup = await this.prisma.ageGroup.create({
      data: {
        name: data.name,
        min_age: data.minAge,
        max_age: data.maxAge,
        description: data.description,
        is_active: data.isActive ?? true,
        display_order: data.displayOrder ?? 0,
        created_by: currentUser.userId,
        fellowship_id: fellowshipId,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.age_group_create',
      entityType: 'age_group',
      entityId: ageGroup.id,
      newValue: { name: data.name, minAge: data.minAge, maxAge: data.maxAge },
    });

    return ageGroup;
  }

  async update(id: string, data: UpdateAgeGroupDto, currentUser: any): Promise<any> {
    if (!isUuid(id)) {
      throw new NotFoundException('Age group not found');
    }
    const ageGroup = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!ageGroup) {
      throw new NotFoundException('Age group not found');
    }
    this.tenantScope.assertInScope(currentUser, ageGroup);

    const minAge = data.minAge ?? ageGroup.min_age;
    const maxAge = data.maxAge ?? ageGroup.max_age;
    if (data.minAge !== undefined || data.maxAge !== undefined) {
      await this.assertNoOverlap(currentUser, ageGroup.fellowship_id, minAge, maxAge, id);
    }

    const updated = await this.prisma.ageGroup.update({
      where: { id },
      data: {
        name: data.name,
        min_age: data.minAge,
        max_age: data.maxAge,
        description: data.description,
        is_active: data.isActive,
        display_order: data.displayOrder,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.age_group_edit',
      entityType: 'age_group',
      entityId: id,
      oldValue: ageGroup,
      newValue: updated,
    });

    return updated;
  }

  // Refreshes YouthProfile.age_group_id for every participant in scope, based on current
  // date_of_birth vs current AgeGroup ranges. Manual/on-demand rather than a scheduled job
  // (rule: no unnecessary schedulers) - call after editing age-group ranges or periodically.
  async recalculate(currentUser: any): Promise<{ updated: number }> {
    const ageGroupWhere = this.tenantScope.scopeWhere(currentUser, { is_active: true }) as any;
    const ageGroups = await this.prisma.ageGroup.findMany({ where: ageGroupWhere });

    const youthWhere = this.tenantScope.scopeWhere(currentUser, {}) as any;
    const profiles = await this.prisma.youthProfile.findMany({ where: youthWhere });

    let updated = 0;
    for (const profile of profiles) {
      const age = computeAge(profile.date_of_birth);
      const match = ageGroups.find((g) => age >= g.min_age && age <= g.max_age);
      const nextAgeGroupId = match?.id ?? null;
      if (nextAgeGroupId !== profile.age_group_id) {
        await this.prisma.youthProfile.update({
          where: { id: profile.id },
          data: { age_group_id: nextAgeGroupId },
        });
        updated += 1;
      }
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'youth.age_group_recalculate',
      entityType: 'age_group',
      comment: `Recalculated age groups for ${updated} participant(s)`,
    });

    return { updated };
  }
}

export function computeAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}
