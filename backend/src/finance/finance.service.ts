import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
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
  campaignId?: string;
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

  // Department leaders see only their own department's records; finance viewers see the fellowship's.
  private visibilityWhere(user: any, ownerField?: 'requester_id'): Record<string, any> {
    if (this.access.isFinanceViewer(user)) return {};
    if (this.access.isDepartmentLeader(user)) {
      if (!user.departmentId) return { id: '00000000-0000-0000-0000-000000000000' };
      const own = { department_id: user.departmentId };
      return ownerField ? { OR: [own, { [ownerField]: user.userId }] } : own;
    }
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  // ===================== CONTRIBUTIONS =====================

  async findAllContributions(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    if (!this.access.isFinanceViewer(user)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = {};
    if (q.memberId) extra.member_id = validateRequiredUuid('memberId', q.memberId);
    if (q.campaignId) extra.campaign_id = validateRequiredUuid('campaignId', q.campaignId);
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
          campaign: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contribution.count({ where }),
    ]);
    return { data, total };
  }

  async recordContribution(dto: CreateContributionDto, user: any): Promise<any> {
    this.requireRecorder(user, 'record contributions');
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const memberId = validateRequiredUuid('memberId', dto?.memberId);
    const amount = validateAmount('amount', dto?.amount);
    const date = validateDate('date', dto?.date) as Date;
    const contributionType = validateText('contributionType', dto?.contributionType, 50, true) as string;
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const receiptId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);
    const notes = validateText('notes', dto?.notes, 500);

    await this.access.assertMember(memberId, fellowshipId);
    if (campaignId) await this.access.assertCampaign(campaignId, fellowshipId);
    if (categoryId) await this.access.assertCategory(categoryId, 'contribution', fellowshipId);
    if (receiptId) await this.access.assertReceipt(receiptId, fellowshipId);
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    const contribution = await this.prisma.contribution.create({
      data: {
        member_id: memberId,
        amount,
        contribution_type: contributionType,
        date,
        campaign_id: campaignId,
        category_id: categoryId,
        receipt_document_id: receiptId,
        notes,
        recorded_by: user.userId,
        recorded_at: new Date(),
        approval_status: 'FINAL_APPROVED',
        fellowship_id: fellowshipId,
      },
    });

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.contribution_create',
      entityType: 'contribution',
      entityId: contribution.id,
      newValue: { amount, type: contributionType, date: date.toISOString(), campaignId, categoryId },
    });

    return contribution;
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
      if (changes.campaign_id) await this.access.assertCampaign(changes.campaign_id, record.fellowship_id);
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
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new BadRequestException("decision must be 'approved' or 'rejected'");
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
      action: `finance.${kind}_${decision === 'approved' ? 'approve' : 'reject'}`,
      entityType: kind,
      entityId: id,
      approvalInfo: { workflowId: updated.id, decision, stage: current.current_stage, resultingStatus: updated.status },
      comment: note || undefined,
    });

    const ownerId = kind === 'money_request' ? entity.requester_id : kind === 'expense' ? entity.recorded_by : entity.created_by;
    if (decision === 'rejected') {
      await this.notificationEngine.create({
        recipientUserId: ownerId,
        eventType: 'finance_approved',
        title: `${LABEL_FOR[kind][0].toUpperCase()}${LABEL_FOR[kind].slice(1)} rejected`,
        message: `Your ${LABEL_FOR[kind]} "${entity.title}" was rejected${note ? `: ${note}` : '. Please correct and resubmit.'}`,
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
    const visibility = this.visibilityWhere(user);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.departmentId && this.access.isFinanceViewer(user)) extra.department_id = validateRequiredUuid('departmentId', q.departmentId);
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
    this.requireRecorder(user, 'create expenses');
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const title = validateText('title', dto?.title, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const amount = validateAmount('amount', dto?.amount);
    const date = validateDate('date', dto?.date) as Date;
    const purpose = validateText('purpose', dto?.purpose, 300);
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const receiptId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);

    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    if (categoryId) await this.access.assertCategory(categoryId, 'expense', fellowshipId);
    if (receiptId) await this.access.assertReceipt(receiptId, fellowshipId);
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    const expense = await this.createWithWorkflow('expense', {
      title, description, amount, date, purpose,
      department_id: departmentId,
      category_id: categoryId,
      receipt_document_id: receiptId,
      recorded_by: user.userId,
      approval_status: 'SUBMITTED',
      fellowship_id: fellowshipId,
    }, user, fellowshipId);

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.expense_create',
      entityType: 'expense',
      entityId: expense.id,
      newValue: { amount, title },
      approvalInfo: { workflowId: expense.approval_workflow_id },
    });
    return expense;
  }

  approveExpense(id: string, decision: any, comment: any, user: any) {
    if (!this.access.hasAnyRole(user, ['secretary', 'assistant_secretary', 'admin', 'chairperson', 'assistant_chairperson'])) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.decidePrimary('expense', id, decision, comment, user);
  }

  // ===================== BUDGETS =====================

  async findAllBudgets(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    const visibility = this.visibilityWhere(user);
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.departmentId && this.access.isFinanceViewer(user)) extra.department_id = validateRequiredUuid('departmentId', q.departmentId);
    if (q.fiscalYear) extra.fiscal_year = validateFiscalYear(q.fiscalYear);
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.BudgetWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.budget.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.budget.count({ where }),
    ]);
    return { data, total };
  }

  async createBudget(dto: CreateBudgetDto, user: any): Promise<any> {
    this.requireRecorder(user, 'create budgets');
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const title = validateText('title', dto?.title, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const amount = validateAmount('amount', dto?.amount);
    const fiscalYear = validateFiscalYear(dto?.fiscalYear);
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);

    const budget = await this.createWithWorkflow('budget', {
      title, description, amount, fiscal_year: fiscalYear,
      department_id: departmentId,
      created_by: user.userId,
      approval_status: 'SUBMITTED',
      fellowship_id: fellowshipId,
    }, user, fellowshipId);

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.budget_create',
      entityType: 'budget',
      entityId: budget.id,
      newValue: { amount, title, fiscalYear },
      approvalInfo: { workflowId: budget.approval_workflow_id },
    });
    return budget;
  }

  approveBudget(id: string, decision: any, comment: any, user: any) {
    if (!this.access.hasAnyRole(user, ['secretary', 'assistant_secretary', 'admin', 'chairperson', 'assistant_chairperson'])) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.decidePrimary('budget', id, decision, comment, user);
  }

  // ===================== MONEY REQUESTS =====================

  async findAllMoneyRequests(user: any, q: ListQuery = {}): Promise<{ data: any[]; total: number }> {
    const visibility = this.visibilityWhere(user, 'requester_id');
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = { ...visibility };
    if (q.departmentId && this.access.isFinanceViewer(user)) extra.department_id = validateRequiredUuid('departmentId', q.departmentId);
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
      // A department leader can only ever request money for their OWN department.
      if (!user.departmentId) throw new ForbiddenException('You are not assigned to a department.');
      if (departmentId && departmentId !== user.departmentId) {
        throw new ForbiddenException('You can only request money for your own department.');
      }
      departmentId = user.departmentId;
    }
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);

    const request = await this.createWithWorkflow('money_request', {
      title, description, amount, purpose,
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
    if (request.approval_status !== 'REJECTED' || !request.approval_workflow_id) {
      throw new BadRequestException('Request is not in rejected state.');
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
