import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { ResourcesAccessService } from './resources-access.service';

export interface NamedDto { name?: string; description?: string; isActive?: boolean; fellowshipId?: string }

type Kind = 'category' | 'location';

// Categories and locations are the same simple lookup shape, so one service handles both.
@Injectable()
export class ResourcesCatalogService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: ResourcesAccessService,
  ) {}

  private model(kind: Kind): any {
    return kind === 'category' ? this.prisma.assetCategory : this.prisma.assetLocation;
  }

  async list(kind: Kind, user: any, fellowshipId?: string) {
    // Department leaders need the lookups to read assets, so any resource viewer may list them.
    this.access.requireViewer(user);
    const where = this.tenantScope.scopeWhere(user, {}, fellowshipId);
    return this.model(kind).findMany({ where, orderBy: { name: 'asc' }, take: 500 });
  }

  async create(kind: Kind, dto: NamedDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const name = validateText('name', dto?.name, 100, true) as string;
    const description = validateText('description', dto?.description, 500);
    const clash = await this.model(kind).findFirst({ where: { fellowship_id: fellowshipId, name }, select: { id: true } });
    if (clash) throw new BadRequestException(`A ${kind} with this name already exists.`);
    const row = await this.model(kind).create({ data: { fellowship_id: fellowshipId, name, description, created_by: user.userId } });
    await this.auditService.log({ userId: user.userId, action: `resources.${kind}_create`, entityType: `asset_${kind}`, entityId: row.id, newValue: { name } });
    return row;
  }

  async update(kind: Kind, id: string, dto: NamedDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.RESOURCES_MANAGE);
    if (!isUuid(id)) throw new NotFoundException(`${kind} not found`);
    const row = await this.model(kind).findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`${kind} not found`);
    this.tenantScope.assertInScope(user, row);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      data.name = validateText('name', dto.name, 100, true);
      const clash = await this.model(kind).findFirst({ where: { fellowship_id: row.fellowship_id, name: data.name, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException(`A ${kind} with this name already exists.`);
    }
    if (dto.description !== undefined) data.description = validateText('description', dto.description, 500);
    if (dto.isActive !== undefined) data.is_active = !!dto.isActive;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.model(kind).update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: `resources.${kind}_edit`, entityType: `asset_${kind}`, entityId: id, newValue: { fields: Object.keys(data) } });
    return updated;
  }
}
