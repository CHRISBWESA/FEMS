import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from './finance.validation';

const KINDS = ['contribution', 'income', 'expense'] as const;
type Kind = (typeof KINDS)[number];

export interface CategoryDto { kind?: string; name?: string; isActive?: boolean; fellowshipId?: string }
export interface CampaignDto {
  name?: string; description?: string; targetAmount?: number | null; startDate?: string; endDate?: string | null;
  status?: string; departmentId?: string | null; fellowshipId?: string;
}
export interface PeriodDto { name?: string; startDate?: string; endDate?: string; fellowshipId?: string }

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

  // ===================== CAMPAIGNS =====================

  private async withProgress(campaigns: any[]): Promise<any[]> {
    if (campaigns.length === 0) return [];
    const ids = campaigns.map((c) => c.id);
    const [sums, perMember] = await Promise.all([
      this.prisma.contribution.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contribution.groupBy({ by: ['campaign_id', 'member_id'], where: { campaign_id: { in: ids } } }),
    ]);
    const income = await this.prisma.incomeRecord.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids } }, _sum: { amount: true } });
    return campaigns.map((c) => {
      const s = sums.find((x) => x.campaign_id === c.id);
      const inc = income.find((x) => x.campaign_id === c.id);
      const contributed = new Prisma.Decimal(s?._sum.amount ?? 0);
      const other = new Prisma.Decimal(inc?._sum.amount ?? 0);
      const raised = contributed.plus(other);
      const target = c.target_amount ? new Prisma.Decimal(c.target_amount) : null;
      return {
        ...c,
        progress: {
          raised: raised.toString(),
          contributions: contributed.toString(),
          otherIncome: other.toString(),
          contributionCount: s?._count._all ?? 0,
          contributorCount: perMember.filter((p) => p.campaign_id === c.id).length,
          percentOfTarget: target && target.greaterThan(0) ? Math.min(100, Math.round(raised.div(target).mul(100).toNumber())) : null,
        },
      };
    });
  }

  async listCampaigns(user: any, q: { status?: string; fellowshipId?: string } = {}) {
    this.requireViewer(user);
    const extra: Record<string, any> = {};
    if (q.status) {
      if (!['active', 'closed'].includes(q.status)) throw new BadRequestException('status must be active or closed');
      extra.status = q.status;
    }
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ContributionCampaignWhereInput;
    return this.withProgress(await this.prisma.contributionCampaign.findMany({ where, orderBy: [{ status: 'asc' }, { start_date: 'desc' }], take: 200 }));
  }

  async getCampaign(id: string, user: any) {
    this.requireViewer(user);
    this.notFoundUnlessUuid(id, 'Campaign');
    const c = await this.prisma.contributionCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    this.tenantScope.assertInScope(user, c);
    return (await this.withProgress([c]))[0];
  }

  async createCampaign(dto: CampaignDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_CAMPAIGN_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const name = validateText('name', dto?.name, 120, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const start = validateDate('startDate', dto?.startDate, { maxFutureDays: 3650 }) as Date;
    const end = validateDate('endDate', dto?.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (end && end < start) throw new BadRequestException('endDate cannot be before startDate');
    const target = dto?.targetAmount === undefined || dto.targetAmount === null ? null : validateAmount('targetAmount', dto.targetAmount);
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    const clash = await this.prisma.contributionCampaign.findFirst({ where: { fellowship_id: fellowshipId, name }, select: { id: true } });
    if (clash) throw new BadRequestException('A campaign with this name already exists.');

    const c = await this.prisma.contributionCampaign.create({
      data: { fellowship_id: fellowshipId, name, description, target_amount: target, start_date: start, end_date: end, department_id: departmentId, created_by: user.userId },
    });
    await this.auditService.log({ userId: user.userId, action: 'finance.campaign_create', entityType: 'campaign', entityId: c.id, newValue: { name, target } });
    return c;
  }

  async updateCampaign(id: string, dto: CampaignDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_CAMPAIGN_MANAGE);
    this.notFoundUnlessUuid(id, 'Campaign');
    const c = await this.prisma.contributionCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    this.tenantScope.assertInScope(user, c);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      data.name = validateText('name', dto.name, 120, true);
      const clash = await this.prisma.contributionCampaign.findFirst({ where: { fellowship_id: c.fellowship_id, name: data.name, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException('A campaign with this name already exists.');
    }
    if (dto.description !== undefined) data.description = validateText('description', dto.description, 1000);
    if (dto.targetAmount !== undefined) data.target_amount = dto.targetAmount === null ? null : validateAmount('targetAmount', dto.targetAmount);
    if (dto.endDate !== undefined) {
      data.end_date = validateDate('endDate', dto.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
      if (data.end_date && data.end_date < c.start_date) throw new BadRequestException('endDate cannot be before startDate');
    }
    if (dto.status !== undefined) {
      if (!['active', 'closed'].includes(dto.status)) throw new BadRequestException('status must be active or closed');
      data.status = dto.status;
    }
    if (dto.departmentId !== undefined) {
      data.department_id = validateOptionalUuid('departmentId', dto.departmentId);
      if (data.department_id) await this.access.assertDepartment(data.department_id, c.fellowship_id);
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.contributionCampaign.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'finance.campaign_edit', entityType: 'campaign', entityId: id, oldValue: { status: c.status }, newValue: { status: updated.status, fields: Object.keys(data) } });
    return updated;
  }

  // ===================== FINANCIAL PERIODS =====================

  async listPeriods(user: any, q: { fellowshipId?: string } = {}) {
    this.requireViewer(user);
    const where = this.tenantScope.scopeWhere(user, {}, q.fellowshipId) as Prisma.FinancialPeriodWhereInput;
    return this.prisma.financialPeriod.findMany({ where, orderBy: { start_date: 'desc' }, take: 200 });
  }

  async createPeriod(dto: PeriodDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_PERIOD_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const name = validateText('name', dto?.name, 80, true) as string;
    const start = validateDate('startDate', dto?.startDate, { maxFutureDays: 3650 }) as Date;
    const end = validateDate('endDate', dto?.endDate, { maxFutureDays: 3650 }) as Date;
    if (end < start) throw new BadRequestException('endDate cannot be before startDate');
    const overlap = await this.prisma.financialPeriod.findFirst({
      where: { fellowship_id: fellowshipId, start_date: { lte: end }, end_date: { gte: start } },
      select: { name: true },
    });
    if (overlap) throw new BadRequestException(`This period overlaps the existing period "${overlap.name}".`);

    const p = await this.prisma.financialPeriod.create({
      data: { fellowship_id: fellowshipId, name, start_date: start, end_date: end, created_by: user.userId },
    });
    await this.auditService.log({ userId: user.userId, action: 'finance.period_create', entityType: 'financial_period', entityId: p.id, newValue: { name } });
    return p;
  }

  async closePeriod(id: string, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_PERIOD_MANAGE);
    this.notFoundUnlessUuid(id, 'Period');
    const p = await this.prisma.financialPeriod.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Period not found');
    this.tenantScope.assertInScope(user, p);
    const res = await this.prisma.financialPeriod.updateMany({
      where: { id, is_closed: false },
      data: { is_closed: true, closed_by: user.userId, closed_at: new Date() },
    });
    if (res.count !== 1) throw new ConflictException('This period is already closed.');
    await this.auditService.log({ userId: user.userId, action: 'finance.period_close', entityType: 'financial_period', entityId: id, newValue: { name: p.name } });
    return this.prisma.financialPeriod.findUnique({ where: { id } });
  }

  // Re-opening a closed period is a senior action: Secretary or Chairperson, with a recorded reason.
  async reopenPeriod(id: string, body: any, user: any) {
    if (!this.access.hasAnyRole(user, ['secretary', 'chairperson', 'assistant_chairperson'])) {
      throw new ForbiddenException('Only the Secretary or Chairperson can re-open a closed period.');
    }
    this.notFoundUnlessUuid(id, 'Period');
    const reason = validateText('reason', body?.reason, 500, true) as string;
    const p = await this.prisma.financialPeriod.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Period not found');
    this.tenantScope.assertInScope(user, p);
    const res = await this.prisma.financialPeriod.updateMany({
      where: { id, is_closed: true },
      data: { is_closed: false, closed_by: null, closed_at: null },
    });
    if (res.count !== 1) throw new ConflictException('This period is not closed.');
    await this.auditService.log({ userId: user.userId, action: 'finance.period_reopen', entityType: 'financial_period', entityId: id, comment: reason });
    return this.prisma.financialPeriod.findUnique({ where: { id } });
  }
}
