import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { FinanceScopeService } from './accounting/finance-scope.service';
import { ContributionsCoreService } from './accounting/contributions-core.service';
import { ExpensesFlowService } from './accounting/expenses-flow.service';
import { BudgetsService } from './accounting/budgets.service';
import { nextNumber } from './accounting/ledger';
import { buildEditChanges, validateFiscalYear, FinanceKind } from './finance-effects';
import {
  assertPeriodOpen,
  validateAmount,
  validateDate,
  validateOptionalUuid,
  validateRequiredUuid,
  validateText,
} from './finance.validation';

export interface CreateContributionDto {
  memberId: string;
  amount: number;
  contributionType: string;
  date: string | Date;
  categoryId?: string;
  receiptDocumentId?: string;
  notes?: string;
  fellowshipId?: string;
}

export interface CreateExpenseDto {
  title: string;
  description?: string;
  amount: number;
  date: string | Date;
  departmentId?: string;
  purpose?: string;
  categoryId?: string;
  receiptDocumentId?: string;
  fellowshipId?: string;
}

export interface CreateBudgetDto {
  title: string;
  description?: string;
  amount: number;
  departmentId?: string;
  fiscalYear: string;
  fellowshipId?: string;
}

export interface CreateMoneyRequestDto {
  departmentId?: string;
  title: string;
  description?: string;
  amount: number;
  purpose: string;
  fellowshipId?: string;
}

export interface ListQuery {
  fellowshipId?: string;
  limit?: string;
  page?: string;
  [key: string]: string | undefined;
}

type PrimaryKind = 'expense' | 'budget' | 'money_request';

const MODEL_FOR: Record<PrimaryKind, 'expense' | 'budget' | 'moneyRequest'> = {
  expense: 'expense',
  budget: 'budget',
  money_request: 'moneyRequest',
};

const LABEL_FOR: Record<PrimaryKind, string> = {
  expense: 'expense',
  budget: 'budget',
  money_request: 'money request',
};

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
    private scope: FinanceScopeService,
    private contributions: ContributionsCoreService,
    private expensesFlow: ExpensesFlowService,
    private budgets: BudgetsService,
  ) {}

  private requireRecorder(user: any, what: string): void {
    if (!this.access.hasAnyRole(user, ['treasurer', 'secretary', 'admin'])) {
      throw new ForbiddenException(`Only the Treasurer or Secretary can ${what}.`);
    }
  }

  private assertUuidParam(id: string, label: string): void {
    if (!isUuid(id)) throw new NotFoundException(`${label} not found`);
  }

  private validateReason(body: any): string {
    return validateText('reason', body?.reason, 500, true) as string;
  }

  // Department leaders see only departments they currently lead; finance viewers see the fellowship's.
  private async visibilityWhere(user: any, ownerField?: 'requester_id', departmentId?: string): Promise<Record<string, any>> {
    if (this.access.isFinanceViewer(user)) {
      if (!departmentId) return {};
      return departmentId === 'central' ? { department_id: null } : { department_id: validateRequiredUuid('departmentId', departmentId) };
    }
    if (this.access.isDepartmentLeader(user)) {
      // Older accounts carry their department on the user record instead of a leadership appointment.
      const legacy = user.departmentId && (!departmentId || departmentId === user.departmentId) ? { department_id: user.departmentId } : { department_id: '00000000-0000-0000-0000-000000000000' };
      const own = await this.scope.listScope(user, departmentId).catch(() => legacy);
      return ownerField && !departmentId ? { OR: [own, { [ownerField]: user.userId }] } : own;
    }
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  // ===================== CONTRIBUTIONS =====================

  async findAllContributions(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    // Giving is sensitive: outside the central officers, only CURRENT leaders of a department (an appointment, not
    // just a role) see that department's own contributions - never central or other departments' giving.
    const visibility = this.access.isFinanceViewer(user)
      ? await this.visibilityWhere(user, undefined, q.departmentId)
      : await this.scope.listScope(user, q.departmentId);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.status) extra.status = q.status === 'reversed' ? 'reversed' : 'active';
    if (q.accountId) extra.account_id = validateRequiredUuid('accountId', q.accountId);
    if (q.paymentMethod) extra.payment_method = validateText('paymentMethod', q.paymentMethod, 30);
    if (q.search) {
      const term = validateText('search', q.search, 100) as string;
      extra.OR = [{ receipt_number: { contains: term, mode: 'insensitive' } }, { contributor_name: { contains: term, mode: 'insensitive' } }, { member: { full_name: { contains: term, mode: 'insensitive' } } }];
    }
    if (q.memberId) extra.member_id = validateRequiredUuid('memberId', q.memberId);
    if (q.categoryId) extra.category_id = validateRequiredUuid('categoryId', q.categoryId);
    if (q.type) extra.contribution_type = validateText('type', q.type, 50) ?? undefined;
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    if (from || to) extra.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ContributionWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where,
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
        take,
        skip,
        include: {
          member: { select: { id: true, full_name: true, member_code: true } },
          category: { select: { id: true, name: true } },
          account: { select: { id: true, name: true } },
          allocations: { where: { is_active: true }, select: { amount: true, project: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.contribution.count({ where }),
    ]);
    return { data, total };
  }

  async recordContribution(dto: CreateContributionDto, user: any): Promise<any> {
    const departmentId = validateOptionalUuid('departmentId', (dto as any)?.departmentId);
    if (departmentId) {
      // A department's own money: recorded by that department's current leaders.
      await this.scope.requireManage(user, departmentId);
    } else {
      this.requireRecorder(user, 'record contributions');
    }
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    if (!fellowshipId) throw new ForbiddenException('Contributions are recorded inside a fellowship.');
    return this.contributions.record(user, dto as any, { fellowshipId, departmentId });
  }

  // ---- edit / delete of any recorded finance record goes through an approval; nothing changes until final approval ----

  private async requestChange(
    kind: FinanceKind,
    action: 'edit' | 'delete',
    id: string,
    body: any,
    user: any,
  ): Promise<any> {
    this.requireRecorder(user, `request ${kind} ${action}s`);
    this.assertUuidParam(id, 'Record');
    const modelName = ({ contribution: 'contribution', expense: 'expense', budget: 'budget', income: 'incomeRecord' } as const)[kind];
    const record = await (this.prisma as any)[modelName].findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Record not found');
    this.tenantScope.assertInScope(user, record);

    const reason = this.validateReason(body);
    const workflowType = `${kind}_${action}`;
    await this.access.assertNoPendingRequest(id, [workflowType]);

    let changes: Record<string, any> | undefined;
    if (action === 'edit') {
      changes = buildEditChanges(kind, body || {});
      if (changes.category_id) await this.access.assertCategory(changes.category_id, kind === 'income' ? 'income' : kind === 'expense' ? 'expense' : 'contribution', record.fellowship_id);
      if (changes.date) await assertPeriodOpen(this.prisma, record.fellowship_id, new Date(changes.date));
    }
    if (kind !== 'budget') {
      await assertPeriodOpen(this.prisma, record.fellowship_id, record.date);
    }

    const approval = await this.prisma.$transaction(async (tx) => {
      const created = await this.approvalEngine.createWorkflow(
        workflowType, id, kind, user.userId, { reason, ...(changes ? { changes } : {}) }, record.fellowship_id, tx,
      );
      return this.approvalEngine.submit(created.id, tx);
    });

    await this.auditService.log({
      userId: user.userId,
      action: `finance.${kind}_${action}_requested`,
      entityType: kind,
      entityId: id,
      approvalInfo: { workflowId: approval.id },
      // The reason is free text supplied by the requester; the proposed values live in the approval, not the audit row.
      comment: reason,
    });
    await this.access.notifyCurrentStage(approval, `${kind} ${action} request`, kind, id, user.userId);
    return approval;
  }

  requestContributionEdit(id: string, body: any, user: any) { return this.requestChange('contribution', 'edit', id, body, user); }
  requestContributionDelete(id: string, body: any, user: any) { return this.requestChange('contribution', 'delete', id, body, user); }
  editExpense(id: string, body: any, user: any) { return this.requestChange('expense', 'edit', id, body, user); }
  deleteExpense(id: string, body: any, user: any) { return this.requestChange('expense', 'delete', id, body, user); }
  editBudget(id: string, body: any, user: any) { return this.requestChange('budget', 'edit', id, body, user); }
  deleteBudget(id: string, body: any, user: any) { return this.requestChange('budget', 'delete', id, body, user); }
  editIncome(id: string, body: any, user: any) { return this.requestChange('income', 'edit', id, body, user); }
  deleteIncome(id: string, body: any, user: any) { return this.requestChange('income', 'delete', id, body, user); }

  // ===================== shared: create an entity together with its approval workflow =====================

  private async createWithWorkflow(
    kind: PrimaryKind,
    data: Record<string, any>,
    user: any,
    fellowshipId: string | null,
  ): Promise<any> {
    const model = MODEL_FOR[kind];
    const { entity, approval } = await this.prisma.$transaction(async (tx) => {
      const created = await (tx as any)[model].create({ data });
      const wf = await this.approvalEngine.createWorkflow(kind, created.id, kind, user.userId, undefined, fellowshipId, tx);
      const linked = await (tx as any)[model].update({ where: { id: created.id }, data: { approval_workflow_id: wf.id } });
      const submitted = await this.approvalEngine.submit(wf.id, tx);
      return { entity: linked, approval: submitted };
    });
    await this.access.notifyCurrentStage(approval, LABEL_FOR[kind], kind, entity.id, user.userId);
    return entity;
  }

  private pickApproverRole(user: any, approval: any): string {
    const step = approval.steps.find((s: any) => s.stage_order === approval.current_stage);
    const stageRole: string | undefined = step?.approver_role;
    const roles = this.access.roles(user);
    if (stageRole && roles.includes(stageRole)) return stageRole;
    if (stageRole === 'secretary' && (roles.includes('assistant_secretary') || roles.includes('admin'))) return 'secretary';
    if (stageRole === 'chairperson' && roles.includes('assistant_chairperson')) return 'chairperson';
    throw new ForbiddenException('You are not the approver for the current stage of this request.');
  }

  // One decision path for expenses, budgets and money requests. The engine performs the decision, the
  // entity-status sync and the stage bookkeeping in ONE conditional transaction, so the record is only
  // FINAL_APPROVED after every stage has approved and a race can't double-decide.
  private async decidePrimary(kind: PrimaryKind, id: string, decision: any, comment: any, user: any): Promise<any> {
    this.assertUuidParam(id, 'Record');
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'returned') {
      throw new BadRequestException("decision must be 'approved', 'returned' or 'rejected'");
    }
    const note = validateText('comment', comment, 500) ?? '';
    const model = MODEL_FOR[kind];
    const entity = await (this.prisma as any)[model].findUnique({ where: { id } });
    if (!entity) throw new NotFoundException('Record not found');
    this.tenantScope.assertInScope(user, entity);
    if (!entity.approval_workflow_id) throw new BadRequestException('No approval workflow for this record.');

    const current = await this.prisma.approval.findUnique({
      where: { id: entity.approval_workflow_id },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
    if (!current) throw new BadRequestException('No approval workflow for this record.');

    const updated = await this.approvalEngine.decide(entity.approval_workflow_id, {
      approverUserId: user.userId,
      approverRole: this.pickApproverRole(user, current),
      decision,
      comment: note,
    });

    await this.auditService.log({
      userId: user.userId,
      action: `finance.${kind}_${decision === 'approved' ? 'approve' : decision === 'returned' ? 'return' : 'reject'}`,
      entityType: kind,
      entityId: id,
      approvalInfo: { workflowId: updated.id, decision, stage: current.current_stage, resultingStatus: updated.status },
      comment: note || undefined,
    });

    const ownerId = kind === 'money_request' ? entity.requester_id : kind === 'expense' ? entity.recorded_by : entity.created_by;
    if (decision === 'returned') {
      await this.notificationEngine.create({
        recipientUserId: ownerId,
        eventType: 'finance_returned',
        title: `${LABEL_FOR[kind][0].toUpperCase()}${LABEL_FOR[kind].slice(1)} returned for revision`,
        message: `Your ${LABEL_FOR[kind]} "${entity.title}" was returned for revision${note ? `: ${note}` : '.'}`,
        entityType: kind,
        entityId: id,
        fellowshipId: entity.fellowship_id,
      });
    } else if (decision === 'rejected') {
      await this.notificationEngine.create({
        recipientUserId: ownerId,
        eventType: 'finance_rejected',
        title: `${LABEL_FOR[kind][0].toUpperCase()}${LABEL_FOR[kind].slice(1)} rejected`,
        message: `Your ${LABEL_FOR[kind]} "${entity.title}" was rejected${note ? `: ${note}` : '.'}`,
        entityType: kind,
        entityId: id,
        fellowshipId: entity.fellowship_id,
      });
    } else if (updated.status === 'FINAL_APPROVED') {
      await this.notificationEngine.create({
        recipientUserId: ownerId,
        eventType: 'finance_approved',
        title: `${LABEL_FOR[kind][0].toUpperCase()}${LABEL_FOR[kind].slice(1)} approved`,
        message: `Your ${LABEL_FOR[kind]} "${entity.title}" has been fully approved.`,
        entityType: kind,
        entityId: id,
        fellowshipId: entity.fellowship_id,
      });
    } else {
      await this.access.notifyCurrentStage(updated, LABEL_FOR[kind], kind, id, user.userId);
    }

    return (this.prisma as any)[model].findUnique({ where: { id } });
  }

  // ===================== EXPENSES =====================

  async findAllExpenses(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    const visibility = await this.visibilityWhere(user, undefined, q.departmentId);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.status) extra.approval_status = validateText('status', q.status, 30);
    if (q.categoryId) extra.category_id = validateRequiredUuid('categoryId', q.categoryId);
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    if (from || to) extra.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ExpenseWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where, orderBy: [{ date: 'desc' }, { created_at: 'desc' }], take, skip,
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.expense.count({ where }),
    ]);
    return { data, total };
  }

  async createExpense(dto: CreateExpenseDto, user: any): Promise<any> {
    // Central expenses (and department expenses paid from the department's own money, with scope: 'department').
    return this.expensesFlow.create(user, dto);
  }

  approveExpense(id: string, decision: any, comment: any, user: any) {
    if (!this.access.hasAnyRole(user, ['secretary', 'assistant_secretary', 'admin', 'chairperson', 'assistant_chairperson'])) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.decidePrimary('expense', id, decision, comment, user);
  }

  // ===================== BUDGETS =====================

  async findAllBudgets(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    const visibility = await this.visibilityWhere(user, undefined, q.departmentId);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.fiscalYear) extra.fiscal_year = validateFiscalYear(q.fiscalYear);
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.BudgetWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.budget.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.budget.count({ where }),
    ]);
    return { data, total };
  }

  async createBudget(dto: CreateBudgetDto, user: any): Promise<any> {
    // Line-item budgets (central, or a department's own with departmentId) - see BudgetsService.
    return this.budgets.create(user, dto);
  }

  approveBudget(id: string, decision: any, comment: any, user: any) {
    if (!this.access.hasAnyRole(user, ['treasurer', 'secretary', 'assistant_secretary', 'admin', 'chairperson', 'assistant_chairperson'])) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.decidePrimary('budget', id, decision, comment, user);
  }

  // ===================== MONEY REQUESTS =====================

  async findAllMoneyRequests(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    const visibility = await this.visibilityWhere(user, 'requester_id', q.departmentId);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.status) extra.approval_status = validateText('status', q.status, 30);
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.MoneyRequestWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.moneyRequest.findMany({
        where, orderBy: { created_at: 'desc' }, take, skip,
        include: { release: { select: { id: true, amount: true, released_at: true, method: true, reference: true } } },
      }),
      this.prisma.moneyRequest.count({ where }),
    ]);
    return { data, total };
  }

  async createMoneyRequest(dto: CreateMoneyRequestDto, user: any): Promise<any> {
    const isSecretary = this.access.hasAnyRole(user, ['secretary', 'assistant_secretary', 'admin']);
    const isDeptLeader = this.access.isDepartmentLeader(user);
    if (!isSecretary && !isDeptLeader) {
      throw new ForbiddenException('Only the Secretary or Department Leaders can create money requests.');
    }
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const title = validateText('title', dto?.title, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const amount = validateAmount('amount', dto?.amount);
    const purpose = validateText('purpose', dto?.purpose, 300, true) as string;
    let departmentId = validateOptionalUuid('departmentId', dto?.departmentId);

    if (isDeptLeader && !isSecretary) {
      // A department leader can only ever request money for a department they currently lead.
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (user.departmentId && !led.includes(user.departmentId)) led.push(user.departmentId);
      if (!led.length) throw new ForbiddenException('You are not assigned to a department.');
      if (departmentId && !led.includes(departmentId)) {
        throw new ForbiddenException('You can only request money for your own department.');
      }
      departmentId = departmentId ?? led[0];
    }
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);

    const extra = await this.moneyRequestExtras(dto as any, fellowshipId);
    const request = await this.createWithWorkflow('money_request', {
      title, description, amount, purpose, ...extra,
      department_id: departmentId,
      requester_id: user.userId,
      approval_status: 'SUBMITTED',
      fellowship_id: fellowshipId,
    }, user, fellowshipId);

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.money_request_create',
      entityType: 'money_request',
      entityId: request.id,
      newValue: { amount, title, departmentId },
      approvalInfo: { workflowId: request.approval_workflow_id },
    });
    return request;
  }

  // Project / budget links, the date needed, the preferred payment method and a reference number.
  private async moneyRequestExtras(dto: any, fellowshipId: string | null): Promise<Record<string, any>> {
    const out: Record<string, any> = {};
    const projectId = validateOptionalUuid('projectId', dto?.projectId);
    const budgetLineId = validateOptionalUuid('budgetLineId', dto?.budgetLineId);
    let budgetId = validateOptionalUuid('budgetId', dto?.budgetId);
    if (projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: projectId, fellowship_id: fellowshipId ?? undefined, status: { in: ['APPROVED', 'ACTIVE'] } } });
      if (!p) throw new BadRequestException('The selected project is not open.');
      out.project_id = projectId;
    }
    if (budgetLineId) {
      const line = await this.prisma.budgetLineItem.findFirst({ where: { id: budgetLineId, is_active: true, budget: { fellowship_id: fellowshipId, approval_status: 'FINAL_APPROVED' } } });
      if (!line) throw new BadRequestException('The selected budget line is not available.');
      budgetId = line.budget_id;
      out.budget_line_id = budgetLineId;
    }
    if (budgetId) {
      const b = await this.prisma.budget.findFirst({ where: { id: budgetId, fellowship_id: fellowshipId } });
      if (!b) throw new BadRequestException('The selected budget is not available.');
      out.budget_id = budgetId;
    }
    const required = validateDate('requiredDate', dto?.requiredDate, { required: false, maxFutureDays: 3650 });
    if (required) out.required_date = required;
    const method = validateText('preferredPaymentMethod', dto?.preferredPaymentMethod, 30);
    if (method) out.preferred_payment_method = method;
    if (dto?.breakdown !== undefined) {
      if (!Array.isArray(dto.breakdown) || dto.breakdown.length > 50) throw new BadRequestException('breakdown must be a list of at most 50 items');
      out.expense_breakdown = dto.breakdown.map((b: any) => ({ item: validateText('breakdown item', b?.item, 150, true), amount: validateAmount('breakdown amount', b?.amount) }));
    }
    if (fellowshipId) {
      out.request_number = await this.prisma.$transaction((tx) => nextNumber(tx, fellowshipId, 'money_request', 'MR'));
    }
    return out;
  }

  approveMoneyRequest(id: string, decision: any, comment: any, user: any) {
    if (!this.access.hasAnyRole(user, ['secretary', 'assistant_secretary', 'admin', 'chairperson', 'assistant_chairperson', 'treasurer'])) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.decidePrimary('money_request', id, decision, comment, user);
  }

  async resubmitMoneyRequest(id: string, user: any): Promise<any> {
    this.assertUuidParam(id, 'Money request');
    const request = await this.prisma.moneyRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Money request not found');
    this.tenantScope.assertInScope(user, request);
    if (request.requester_id !== user.userId) {
      throw new ForbiddenException('Only the requester can resubmit.');
    }
    if (request.approval_status !== 'RETURNED' || !request.approval_workflow_id) {
      throw new BadRequestException('Only a request returned for revision can be resubmitted.');
    }

    // The engine reopens the workflow AND moves the request's status to RESUBMITTED atomically.
    const approval = await this.approvalEngine.resubmit(request.approval_workflow_id, user.userId, this.access.roles(user));

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.money_request_resubmit',
      entityType: 'money_request',
      entityId: id,
    });
    await this.access.notifyCurrentStage(approval, 'money request', 'money_request', id, user.userId);
    return this.prisma.moneyRequest.findUnique({ where: { id } });
  }
}
