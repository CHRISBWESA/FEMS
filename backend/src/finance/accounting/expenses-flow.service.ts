import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAttachments } from '../../department-workspace/department.util';
import { assertPeriodOpen, validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance.validation';
import { assertAccountScope, D, getSettings, money, nextNumber, postEntry } from './ledger';
import { lineUsage } from './budget-math';
import { assertProjectForScope } from './contributions-core.service';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

/** Workflows that mean the expense went through central approval (and so may exceed a budget line). */
const CENTRAL_EXPENSE_WORKFLOWS = ['expense', 'department_expense_major'];

/**
 * Expenses from request to payment.
 *
 *  - Central: the Treasurer records, the Fellowship Secretary reviews, the Chairperson approves, the Treasurer pays.
 *  - Department (its own money): the Department Secretary records. Routine spending inside an approved department
 *    budget line is approved by the Department Chairperson; anything larger, over budget, without a budget line, or
 *    submitted by the Chairperson goes to central approval (Treasurer -> Secretary -> Chairperson).
 *  - Approved is not paid. Payment is a separate step that takes money out of an account through the ledger.
 *  - Money already spent (a reimbursement) needs evidence and verification before it is paid.
 */
@Injectable()
export class ExpensesFlowService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: FinanceScopeService,
    private notify: FinanceNotifyService,
  ) {}

  async create(user: any, body: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = validateOptionalUuid('departmentId', body?.departmentId);
    const ownFunds = body?.scope === 'department';
    if (ownFunds && !departmentId) throw new BadRequestException('Choose the department whose money pays this expense.');
    const role = ownFunds
      ? await this.scope.requireManage(user, departmentId)
      : await this.scope.requireManage(user, null, { central: ['treasurer', 'secretary'] });
    if (!ownFunds && departmentId) await this.scope.department(user, departmentId);
    const fundDept = ownFunds ? departmentId : null;

    const title = validateText('title', body?.title, 200, true) as string;
    const description = validateText('description', body?.description, 1000);
    const amount = D(validateAmount('amount', body?.amount));
    const date = validateDate('date', body?.date, { maxFutureDays: 366 }) as Date;
    const purpose = validateText('purpose', body?.purpose, 300);
    const payee = validateText('payee', body?.payee, 150);
    const categoryId = validateOptionalUuid('categoryId', body?.categoryId);
    const projectId = validateOptionalUuid('projectId', body?.projectId);
    const activityId = validateOptionalUuid('activityId', body?.activityId);
    const budgetLineId = validateOptionalUuid('budgetLineId', body?.budgetLineId);
    let budgetId = validateOptionalUuid('budgetId', body?.budgetId);
    const accountId = validateOptionalUuid('accountId', body?.accountId);
    const receiptId = validateOptionalUuid('receiptDocumentId', body?.receiptDocumentId);
    const alreadyIncurred = body?.alreadyIncurred === true;
    const attachments = validateAttachments('attachments', body?.attachments ?? []);
    if (alreadyIncurred && !attachments.length && !receiptId) {
      throw new BadRequestException('Money already spent needs evidence: attach the receipt or invoice.');
    }
    const settings = await getSettings(this.prisma as any, fellowshipId);
    const method = validateText('paymentMethod', body?.paymentMethod, 30);
    if (method && !settings.payment_methods.includes(method)) throw new BadRequestException(`paymentMethod must be one of: ${settings.payment_methods.join(', ')}`);

    if (categoryId) {
      const cat = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, fellowship_id: fellowshipId, kind: 'expense', is_active: true } });
      if (!cat) throw new BadRequestException('The selected category is not available.');
    }
    if (projectId) await assertProjectForScope(this.prisma, projectId, fellowshipId, fundDept);
    if (activityId) {
      const act = await this.prisma.activity.findFirst({ where: { id: activityId, fellowship_id: fellowshipId }, select: { id: true } });
      if (!act) throw new BadRequestException('The selected activity is not available.');
    }
    if (accountId) await assertAccountScope(this.prisma, accountId, fellowshipId, fundDept);
    if (receiptId) {
      const doc = await this.prisma.documentEntity.findFirst({ where: { id: receiptId, fellowship_id: fellowshipId, is_website_content: false }, select: { id: true } });
      if (!doc) throw new BadRequestException('The selected receipt document is not available.');
    }
    let lineRemaining: any = null;
    if (budgetLineId) {
      const line = await this.prisma.budgetLineItem.findFirst({ where: { id: budgetLineId, is_active: true }, include: { budget: true } });
      if (!line || line.budget.fellowship_id !== fellowshipId) throw new BadRequestException('The selected budget line is not available.');
      if ((line.budget.department_id ?? null) !== (fundDept ?? null)) throw new BadRequestException('That budget belongs to a different fund.');
      if (line.budget.approval_status !== 'FINAL_APPROVED') throw new BadRequestException('Spending can only be charged to an approved budget.');
      budgetId = line.budget_id;
      lineRemaining = (await lineUsage(this.prisma, budgetLineId))!.remaining;
    } else if (budgetId) {
      const b = await this.prisma.budget.findFirst({ where: { id: budgetId, fellowship_id: fellowshipId } });
      if (!b || (b.department_id ?? null) !== (fundDept ?? null)) throw new BadRequestException('The selected budget is not available.');
    }
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    let workflow = 'expense';
    let why: string | null = null;
    if (ownFunds) {
      const threshold = settings.major_expense_threshold ? D(settings.major_expense_threshold) : null;
      if (role === 'department_chairperson') why = 'submitted by the Department Chairperson';
      else if (!budgetLineId) why = 'not charged to an approved budget line';
      else if (lineRemaining && lineRemaining.lessThan(amount)) why = 'more than the budget line has left';
      else if (threshold && amount.greaterThanOrEqualTo(threshold)) why = `at or above the ${money(threshold)} limit for routine spending`;
      workflow = why ? 'department_expense_major' : 'department_expense';
    }

    const expense = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, fellowshipId, 'expense', 'EXP', date);
      const e = await tx.expense.create({
        data: {
          fellowship_id: fellowshipId, department_id: departmentId, title, description, purpose, amount: amount.toFixed(2), date,
          category_id: categoryId, project_id: projectId, activity_id: activityId, budget_id: budgetId, budget_line_id: budgetLineId,
          payee, payment_method: method, account_id: accountId, receipt_document_id: receiptId, already_incurred: alreadyIncurred,
          attachments: attachments as any, expense_number: number, recorded_by: user.userId, approval_status: 'SUBMITTED',
        },
      });
      const wf = await this.engine.createWorkflow(
        workflow, e.id, 'expense', user.userId,
        { departmentId: fundDept, ownFunds, reason: why, amount: amount.toFixed(2) },
        fellowshipId, tx, { preparedByTreasurer: this.scope.isTreasurer(user) },
      );
      await tx.expense.update({ where: { id: e.id }, data: { approval_workflow_id: wf.id } });
      const submitted = await this.engine.submit(wf.id, tx, user.userId);
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.expense_create', entity_type: 'expense', entity_id: e.id, fellowship_id: fellowshipId, new_value: { amount: amount.toFixed(2), title, workflow, departmentId, ownFunds, reason: why } as any } });
      return { e, submitted };
    });
    await this.notify.stage(expense.submitted, 'expense', 'expense', expense.e.id, user.userId);
    return this.detail(user, expense.e.id);
  }

  async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Expense not found');
    const e = await this.prisma.expense.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }

  /** Whose money pays it: the department's own (department_* workflow) or central. */
  private async fundOf(e: any): Promise<string | null> {
    if (!e.approval_workflow_id) return null;
    const a = await this.prisma.approval.findUnique({ where: { id: e.approval_workflow_id }, select: { workflow_type: true, metadata: true } });
    return a && a.workflow_type.startsWith('department_') ? ((a.metadata as any)?.departmentId ?? e.department_id) : null;
  }

  async detail(user: any, id: string) {
    const e = await this.load(user, id);
    const fund = await this.fundOf(e);
    if (fund) await this.scope.requireView(user, fund);
    else if (!this.scope.isCentralViewer(user)) {
      // A department leader may see central spending made FOR their department (e.g. a paid money request).
      if (!e.department_id || !(await this.scope.leaderRole(user, e.department_id))) throw new ForbiddenException('You do not have access to this expense.');
    }
    const [approval, account, category, project] = await Promise.all([
      e.approval_workflow_id ? this.prisma.approval.findUnique({ where: { id: e.approval_workflow_id }, include: { steps: { orderBy: { stage_order: 'asc' } } } }) : null,
      e.account_id ? this.prisma.financialAccount.findUnique({ where: { id: e.account_id }, select: { id: true, name: true } }) : null,
      e.category_id ? this.prisma.financeCategory.findUnique({ where: { id: e.category_id }, select: { id: true, name: true } }) : null,
      e.project_id ? this.prisma.project.findUnique({ where: { id: e.project_id }, select: { id: true, name: true, project_number: true } }) : null,
    ]);
    const history = approval ? await this.engine.history(approval.id) : [];
    return {
      ...e, amount: money(e.amount), amount_approved: e.amount_approved ? money(e.amount_approved) : null, amount_paid: e.amount_paid ? money(e.amount_paid) : null,
      fund: fund ? 'department' : 'central', displayStatus: displayStatus(e), account, category, project,
      workflow: approval ? { id: approval.id, type: approval.workflow_type, status: approval.status, currentStage: approval.current_stage, steps: approval.steps, reason: (approval.metadata as any)?.reason ?? null } : null,
      history,
    };
  }

  async verify(user: any, id: string) {
    const e = await this.load(user, id);
    if (!e.already_incurred) throw new BadRequestException('Only money already spent needs verification.');
    if (e.verified_at) throw new ConflictException('This expense has already been verified.');
    if (e.recorded_by === user.userId) throw new ForbiddenException('You cannot verify an expense that you recorded.');
    const fund = await this.fundOf(e);
    if (fund && !this.scope.isTreasurer(user)) await this.scope.requireManage(user, fund, { office: 'department_chairperson' });
    else if (!fund) await this.scope.requireManage(user, null);
    const done = await this.prisma.expense.updateMany({ where: { id, verified_at: null }, data: { verified_at: new Date(), verified_by: user.userId } });
    if (done.count !== 1) throw new ConflictException('This expense has already been verified.');
    await this.audit(user, 'finance.expense_verify', id);
    return this.detail(user, id);
  }

  async pay(user: any, id: string, body: any) {
    const e = await this.load(user, id);
    const fund = await this.fundOf(e);
    await this.scope.requireManage(user, fund);
    if (e.money_request_id) throw new ConflictException('This expense was paid through its money request.');
    if (e.approval_status !== 'FINAL_APPROVED') throw new ConflictException('Only a fully approved expense can be paid.');
    if (e.payment_status !== 'unpaid' || e.reversed_at) throw new ConflictException('This expense has already been paid or reversed.');
    if (e.already_incurred && !e.verified_at) throw new ConflictException('Money already spent must be verified before it is reimbursed.');
    const accountId = validateOptionalUuid('accountId', body?.accountId) ?? e.account_id;
    if (!accountId) throw new BadRequestException('Choose the account the money is paid from.');
    const approved = D(e.amount_approved ?? e.amount);
    const paid = body?.amount === undefined || body.amount === '' ? approved : D(validateAmount('amount', body.amount));
    if (paid.greaterThan(approved)) throw new ConflictException('The amount paid cannot exceed the approved amount.');
    const paidAt = (validateDate('paidAt', body?.paidAt, { required: false }) ?? new Date()) as Date;
    const settings = await getSettings(this.prisma as any, e.fellowship_id!);
    const method = (validateText('paymentMethod', body?.paymentMethod, 30) ?? e.payment_method ?? 'cash') as string;
    if (!settings.payment_methods.includes(method)) throw new BadRequestException(`paymentMethod must be one of: ${settings.payment_methods.join(', ')}`);
    const reference = validateText('paymentReference', body?.paymentReference, 100);
    await assertPeriodOpen(this.prisma, e.fellowship_id, paidAt);

    const wf = e.approval_workflow_id ? await this.prisma.approval.findUnique({ where: { id: e.approval_workflow_id }, select: { workflow_type: true } }) : null;
    if (e.budget_line_id && !CENTRAL_EXPENSE_WORKFLOWS.includes(wf?.workflow_type ?? '')) {
      const usage = await lineUsage(this.prisma, e.budget_line_id, e.id);
      if (usage && usage.remaining.lessThan(paid)) {
        throw new ConflictException(`This would overspend the budget line "${usage.line.name}" (${money(usage.remaining)} left). It needs central approval.`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await assertAccountScope(tx, accountId, e.fellowship_id!, fund);
      const locked = await tx.expense.updateMany({
        where: { id, payment_status: 'unpaid', approval_status: 'FINAL_APPROVED', reversed_at: null },
        data: { payment_status: 'paid', amount_paid: paid.toFixed(2), amount_approved: approved.toFixed(2), account_id: accountId, paid_at: paidAt, paid_by: user.userId, payment_method: method, payment_reference: reference },
      });
      if (locked.count !== 1) throw new ConflictException('This expense has already been paid.');
      await postEntry(tx, {
        fellowshipId: e.fellowship_id!, accountId, amount: paid.negated(), entryType: 'expense', sourceType: 'expense', sourceId: e.id,
        date: paidAt, userId: user.userId, departmentId: fund, projectId: e.project_id, reference: e.expense_number, description: e.title, primary: true,
      });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.expense_paid', entity_type: 'expense', entity_id: id, fellowship_id: e.fellowship_id, new_value: { amount: paid.toFixed(2), accountId, method } as any } });
    });
    await this.notify.send([e.recorded_by], { eventType: 'finance_paid', title: 'Expense paid', message: `${e.expense_number ?? 'An expense'} has been paid.`, entityType: 'expense', entityId: id, fellowshipId: e.fellowship_id }, user.userId);
    if (e.budget_line_id) await this.budgetWarning(e.budget_line_id, e.fellowship_id!, fund, user.userId);
    return this.detail(user, id);
  }

  async cancel(user: any, id: string, body: any) {
    const e = await this.load(user, id);
    const fund = await this.fundOf(e);
    const reason = validateText('reason', body?.reason, 300, true) as string;
    if (e.payment_status !== 'unpaid' || e.reversed_at) throw new ConflictException('A paid expense cannot be cancelled; request a reversal.');
    if (['REJECTED', 'CANCELLED'].includes(e.approval_status)) throw new ConflictException('This expense is already closed.');
    if (e.recorded_by !== user.userId) await this.scope.requireManage(user, fund, fund ? { office: 'department_chairperson' } : {});
    await this.prisma.$transaction(async (tx) => {
      if (e.approval_workflow_id) await this.engine.cancel(e.approval_workflow_id, user.userId, tx);
      await tx.expense.update({ where: { id }, data: { approval_status: 'CANCELLED', reversal_reason: reason } });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.expense_cancel', entity_type: 'expense', entity_id: id, fellowship_id: e.fellowship_id, comment: reason } });
    });
    return this.detail(user, id);
  }

  /** Warns the people responsible when a budget line passes the warning threshold or is overspent. */
  private async budgetWarning(lineId: string, fellowshipId: string, departmentId: string | null, actor: string) {
    const usage = await lineUsage(this.prisma, lineId);
    if (!usage) return;
    const settings = await getSettings(this.prisma as any, fellowshipId);
    const used = usage.approved.isZero() ? 100 : usage.spent.plus(usage.committed).div(usage.approved).times(100).toNumber();
    if (used < settings.budget_warning_percent) return;
    const recipients = [
      ...(await this.scope.usersWithRoles(fellowshipId, ['treasurer'])),
      ...(departmentId ? await this.scope.departmentLeaderIds(departmentId) : []),
    ];
    const over = usage.remaining.isNegative();
    await this.notify.send(recipients, {
      eventType: over ? 'budget_overspent' : 'budget_threshold',
      title: over ? 'Budget line overspent' : 'Budget line nearly used',
      message: `"${usage.line.name}" has used ${Math.round(used)}% of its approved amount.`,
      entityType: 'budget', entityId: usage.line.budget_id, fellowshipId,
    }, actor);
  }

  private async audit(user: any, action: string, id: string) {
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action, entity_type: 'expense', entity_id: id, fellowship_id: user.fellowshipId ?? null } });
  }
}

/** The plain-language state of an expense: requested, approved, paid, rejected, cancelled, awaiting verification. */
export function displayStatus(e: any): string {
  if (e.payment_status === 'reversed' || (e.reversed_at && e.payment_status === 'paid')) return 'reversed';
  if (e.payment_status === 'paid') return 'paid';
  if (e.approval_status === 'REJECTED') return 'rejected';
  if (e.approval_status === 'CANCELLED') return 'cancelled';
  if (e.approval_status === 'RETURNED') return 'returned';
  if (e.already_incurred && !e.verified_at) return 'awaiting_verification';
  if (e.approval_status === 'FINAL_APPROVED') return 'approved';
  return 'requested';
}
