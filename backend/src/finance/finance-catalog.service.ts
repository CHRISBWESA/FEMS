import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { FinanceScopeService } from './accounting/finance-scope.service';
import { FinanceNotifyService } from './accounting/finance-notify.service';
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
    private engine: ApprovalEngineService,
    private scope: FinanceScopeService,
    private notify: FinanceNotifyService,
  ) {}

  private static CAMPAIGN_STATUSES = ['active', 'closed', 'draft', 'paused'];

  // Central campaigns: the Treasurer/Secretary. A department's campaign: also that department's Chairperson.
  private async requireCampaignManager(user: any, departmentId: string | null) {
    if (this.access.hasPermission(user, PERMISSIONS.FINANCE_CAMPAIGN_MANAGE)) return;
    if (departmentId && (await this.scope.leaderRole(user, departmentId)) === 'department_chairperson') return;
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  private async campaignExtras(dto: any, fellowshipId: string | null, departmentId: string | null) {
    const data: Record<string, any> = {};
    if (dto?.projectId !== undefined) {
      const projectId = validateOptionalUuid('projectId', dto.projectId);
      if (projectId) {
        const p = await this.prisma.project.findFirst({ where: { id: projectId, fellowship_id: fellowshipId ?? undefined, status: { notIn: ['REJECTED', 'CLOSED'] } } });
        if (!p) throw new BadRequestException('The selected project is not available.');
        if ((p.scope === 'department' ? p.department_id : null) !== (departmentId ?? null)) throw new BadRequestException('The campaign and its project must belong to the same fund.');
      }
      data.project_id = projectId;
    }
    if (dto?.budgetBreakdown !== undefined) {
      if (!Array.isArray(dto.budgetBreakdown) || dto.budgetBreakdown.length > 50) throw new BadRequestException('budgetBreakdown must be a list of at most 50 items');
      data.budget_breakdown = dto.budgetBreakdown.map((b: any) => ({ item: validateText('budget item', b?.item, 150, true), amount: validateAmount('budget amount', b?.amount) }));
    }
    return data;
  }

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
      this.prisma.contribution.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, status: 'active' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contribution.groupBy({ by: ['campaign_id', 'member_id'], where: { campaign_id: { in: ids }, status: 'active' } }),
    ]);
    const income = await this.prisma.incomeRecord.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, status: 'active' }, _sum: { amount: true } });
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

  async listCampaigns(user: any, q: { status?: string; fellowshipId?: string; departmentId?: string } = {}) {
    // Department leaders see their own departments' campaigns only.
    const extra: Record<string, any> = !this.access.isFinanceViewer(user) || q.departmentId ? await this.scope.listScope(user, q.departmentId) : {};
    if (q.status) {
      if (!FinanceCatalogService.CAMPAIGN_STATUSES.includes(q.status)) throw new BadRequestException('status must be active, paused, draft or closed');
      extra.status = q.status;
    }
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ContributionCampaignWhereInput;
    return this.withProgress(await this.prisma.contributionCampaign.findMany({ where, orderBy: [{ status: 'asc' }, { start_date: 'desc' }], take: 200 }));
  }

  async getCampaign(id: string, user: any) {
    this.notFoundUnlessUuid(id, 'Campaign');
    const c = await this.prisma.contributionCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    this.tenantScope.assertInScope(user, c);
    if (!this.access.isFinanceViewer(user)) await this.scope.requireView(user, c.department_id);
    return (await this.withProgress([c]))[0];
  }

  async createCampaign(dto: CampaignDto, user: any) {
    await this.requireCampaignManager(user, validateOptionalUuid('departmentId', dto?.departmentId));
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

    const extras = await this.campaignExtras(dto, fellowshipId, departmentId);
    const status = dto?.status === undefined ? 'active' : dto.status;
    if (!['active', 'draft'].includes(status)) throw new BadRequestException('A new campaign starts as active or draft');
    const c = await this.prisma.contributionCampaign.create({
      data: { fellowship_id: fellowshipId, name, description, target_amount: target, start_date: start, end_date: end, department_id: departmentId, created_by: user.userId, status: status as any, ...extras },
    });
    await this.auditService.log({ userId: user.userId, action: 'finance.campaign_create', entityType: 'campaign', entityId: c.id, newValue: { name, target } });
    return c;
  }

  async updateCampaign(id: string, dto: CampaignDto, user: any) {
    this.notFoundUnlessUuid(id, 'Campaign');
    const c = await this.prisma.contributionCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    this.tenantScope.assertInScope(user, c);
    await this.requireCampaignManager(user, c.department_id);

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
      if (!FinanceCatalogService.CAMPAIGN_STATUSES.includes(dto.status)) throw new BadRequestException('status must be active, paused, draft or closed');
      data.status = dto.status;
      // A paused or closed campaign leaves the public website at once.
      if (dto.status !== 'active') data.is_public = false;
    }
    Object.assign(data, await this.campaignExtras(dto, c.fellowship_id, (data.department_id !== undefined ? data.department_id : c.department_id) ?? null));
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

    const periodType = (dto as any)?.periodType ?? 'custom';
    if (!['year', 'quarter', 'month', 'custom'].includes(periodType)) throw new BadRequestException('periodType must be year, quarter, month or custom');
    const p = await this.prisma.financialPeriod.create({
      data: { fellowship_id: fellowshipId, name, start_date: start, end_date: end, created_by: user.userId, period_type: periodType },
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
    if (p.period_type === 'year' && !p.is_closed) {
      // Year-end: the Treasurer prepares the statements; the Secretary reviews and the Chairperson approves the closure.
      if (p.closure_status === 'pending') throw new ConflictException('This year is already waiting for closure approval.');
      const approval = await this.prisma.$transaction(async (tx) => {
        if (p.closure_workflow_id && ['returned', 'rejected'].includes(p.closure_status ?? '')) {
          await tx.financialPeriod.update({ where: { id }, data: { closure_status: 'pending' } });
          return this.engine.resubmit(p.closure_workflow_id, user.userId, this.access.roles(user), { anyRequester: true, db: tx });
        }
        const wf = await this.engine.createWorkflow('period_close', id, 'financial_period', user.userId, { name: p.name }, p.fellowship_id, tx);
        await tx.financialPeriod.update({ where: { id }, data: { closure_workflow_id: wf.id, closure_status: 'pending' } });
        return this.engine.submit(wf.id, tx, user.userId);
      });
      await this.auditService.log({ userId: user.userId, action: 'finance.period_close_requested', entityType: 'financial_period', entityId: id, newValue: { name: p.name } });
      await this.notify.stage(approval, 'financial year closure', 'financial_period', id, user.userId);
      return this.prisma.financialPeriod.findUnique({ where: { id } });
    }
    const res = await this.prisma.financialPeriod.updateMany({
      where: { id, is_closed: false },
      data: { is_closed: true, closed_by: user.userId, closed_at: new Date(), closure_status: 'approved' },
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
      data: { is_closed: false, closed_by: null, closed_at: null, closure_status: null, reopened_by: user.userId, reopened_at: new Date(), reopen_reason: reason },
    });
    if (res.count !== 1) throw new ConflictException('This period is not closed.');
    await this.auditService.log({ userId: user.userId, action: 'finance.period_reopen', entityType: 'financial_period', entityId: id, comment: reason });
    return this.prisma.financialPeriod.findUnique({ where: { id } });
  }
}
