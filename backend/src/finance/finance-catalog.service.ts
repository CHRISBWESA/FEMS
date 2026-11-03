import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { validateText } from './finance.validation';

const KINDS = ['contribution', 'income', 'expense'] as const;
type Kind = (typeof KINDS)[number];

export interface CategoryDto { kind?: string; name?: string; isActive?: boolean; fellowshipId?: string }

@Injectable()
export class FinanceCatalogService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
  ) {}

  private requireViewer(user: any) {
    if (!this.access.isFinanceViewer(user)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  private notFoundUnlessUuid(id: string, label: string) {
    if (!isUuid(id)) throw new NotFoundException(`${label} not found`);
  }

  // ===================== CATEGORIES =====================

  async listCategories(user: any, q: { kind?: string; fellowshipId?: string } = {}) {
    this.requireViewer(user);
    const extra: Record<string, any> = {};
    if (q.kind) {
      if (!KINDS.includes(q.kind as Kind)) throw new BadRequestException(`kind must be one of: ${KINDS.join(', ')}`);
      extra.kind = q.kind;
    }
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.FinanceCategoryWhereInput;
    return this.prisma.financeCategory.findMany({ where, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  }

  async createCategory(dto: CategoryDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_CATEGORY_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    if (!KINDS.includes(dto?.kind as Kind)) throw new BadRequestException(`kind must be one of: ${KINDS.join(', ')}`);
    const name = validateText('name', dto?.name, 80, true) as string;
    const clash = await this.prisma.financeCategory.findFirst({ where: { fellowship_id: fellowshipId, kind: dto.kind as Kind, name }, select: { id: true } });
    if (clash) throw new BadRequestException('A category with this name already exists.');

    const cat = await this.prisma.financeCategory.create({
      data: { fellowship_id: fellowshipId, kind: dto.kind as Kind, name, created_by: user.userId },
    });
    await this.auditService.log({ userId: user.userId, action: 'finance.category_create', entityType: 'finance_category', entityId: cat.id, newValue: { kind: cat.kind, name } });
    return cat;
  }

  async updateCategory(id: string, dto: CategoryDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_CATEGORY_MANAGE);
    this.notFoundUnlessUuid(id, 'Category');
    const cat = await this.prisma.financeCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');
    this.tenantScope.assertInScope(user, cat);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      data.name = validateText('name', dto.name, 80, true);
      const clash = await this.prisma.financeCategory.findFirst({ where: { fellowship_id: cat.fellowship_id, kind: cat.kind, name: data.name, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException('A category with this name already exists.');
    }
    if (dto.isActive !== undefined) data.is_active = !!dto.isActive;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.financeCategory.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'finance.category_edit', entityType: 'finance_category', entityId: id, oldValue: { name: cat.name, is_active: cat.is_active }, newValue: { name: updated.name, is_active: updated.is_active } });
    return updated;
  }
}
