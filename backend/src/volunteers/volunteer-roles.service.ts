import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { normalizeTags } from '../members/member.util';
import { VolunteersAccessService } from './volunteers-access.service';

export interface ServiceRoleDto { name?: string; description?: string; requiredSkills?: string[]; isActive?: boolean; fellowshipId?: string }

// Volunteer roles are configuration ("Usher", "Sound desk", "Children's helper"), never hard-coded.
@Injectable()
export class VolunteerRolesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: VolunteersAccessService,
  ) {}

  // Anyone in the fellowship may read the (non-sensitive) role names; inactive roles only for managers.
  async list(user: any, fellowshipId?: string) {
    const isStaff = this.access.staffMode(user) !== null;
    const where = this.tenantScope.scopeWhere(user, isStaff ? {} : { is_active: true }, fellowshipId);
    return this.prisma.serviceRole.findMany({ where, orderBy: { name: 'asc' }, take: 500 });
  }

  async create(dto: ServiceRoleDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.VOLUNTEER_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const name = validateText('name', dto?.name, 100, true) as string;
    const description = validateText('description', dto?.description, 500);
    const skills = dto?.requiredSkills === undefined ? [] : normalizeTags('requiredSkills', dto.requiredSkills);
    const clash = await this.prisma.serviceRole.findFirst({ where: { fellowship_id: fellowshipId, name }, select: { id: true } });
    if (clash) throw new BadRequestException('A role with this name already exists.');
    const row = await this.prisma.serviceRole.create({ data: { fellowship_id: fellowshipId, name, description, required_skills: skills, created_by: user.userId } });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.role_create', entityType: 'service_role', entityId: row.id, newValue: { name } });
    return row;
  }

  async update(id: string, dto: ServiceRoleDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.VOLUNTEER_MANAGE);
    if (!isUuid(id)) throw new NotFoundException('Role not found');
    const row = await this.prisma.serviceRole.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Role not found');
    this.tenantScope.assertInScope(user, row);
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) {
      const name = validateText('name', dto.name, 100, true) as string;
      const clash = await this.prisma.serviceRole.findFirst({ where: { fellowship_id: row.fellowship_id, name, NOT: { id } }, select: { id: true } });
      if (clash) throw new BadRequestException('A role with this name already exists.');
      data.name = name;
    }
    if (dto?.description !== undefined) data.description = validateText('description', dto.description, 500);
    if (dto?.requiredSkills !== undefined) data.required_skills = normalizeTags('requiredSkills', dto.requiredSkills);
    if (dto?.isActive !== undefined) {
      if (typeof dto.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false');
      data.is_active = dto.isActive;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');
    const updated = await this.prisma.serviceRole.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'volunteer.role_update', entityType: 'service_role', entityId: id, newValue: { fields: Object.keys(data) } });
    return updated;
  }
}
