import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { FinanceNotifyService } from './accounting/finance-notify.service';
import { validateDate, validateText } from './finance.validation';

const KINDS = ['contribution', 'income', 'expense'] as const;
type Kind = (typeof KINDS)[number];

export interface CategoryDto { kind?: string; name?: string; isActive?: boolean; fellowshipId?: string }
export interface PeriodDto { name?: string; startDate?: string; endDate?: string; fellowshipId?: string }

@Injectable()
export class FinanceCatalogService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
    private engine: ApprovalEngineService,
    private notify: FinanceNotifyService,
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
