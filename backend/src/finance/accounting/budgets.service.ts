import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance.validation';
import { validateFiscalYear } from '../finance-effects';
import { D, getSettings, money, nextNumber, ZERO } from './ledger';
import { budgetPerformance } from './budget-math';
import { assertProjectForScope } from './contributions-core.service';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

const BUDGET_TYPES = ['annual', 'department', 'project', 'activity', 'fundraising'];

interface LineInput { id?: string; name?: string; categoryId?: string | null; amount?: number | string; notes?: string | null }

/**
 * Budgets with line items.
 *  - Central budgets: prepared by the Treasurer, reviewed by the Fellowship Secretary, approved by the Chairperson.
 *  - Department budgets: prepared by the department's leaders (usually answering the Secretary's budget call);
 *    Treasurer review -> Fellowship Secretary -> Fellowship Chairperson.
 *  - Revisions need a reason and the same central approval; the previous approved version is kept, and a pending
 *    revision never changes the budget until it is fully approved.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: FinanceScopeService,
    private notify: FinanceNotifyService,
  ) {}

  private async parseLines(list: unknown, fellowshipId: string, allowIds = false) {
    if (!Array.isArray(list) || !list.length) throw new BadRequestException('Add at least one budget line.');
    if (list.length > 100) throw new BadRequestException('A budget can have at most 100 lines.');
    const out: { id?: string; name: string; categoryId: string | null; amount: string; notes: string | null }[] = [];
    for (const l of list as LineInput[]) {
      const categoryId = validateOptionalUuid('line categoryId', l?.categoryId);
      if (categoryId) {
        const cat = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, fellowship_id: fellowshipId, kind: 'expense' } });
        if (!cat) throw new BadRequestException('A budget line uses a category that is not available.');
      }
      out.push({
        ...(allowIds && l?.id && isUuid(l.id) ? { id: l.id } : {}),
        name: validateText('line name', l?.name, 150, true) as string,
        categoryId,
        amount: validateAmount('line amount', l?.amount, { allowZero: true }),
        notes: validateText('line notes', l?.notes, 300),
      });
    }
    const total = out.reduce((s, l) => s.plus(l.amount), ZERO);
    if (total.lessThanOrEqualTo(0)) throw new BadRequestException('The budget total must be greater than zero.');
    return { lines: out, total };
  }

  async create(user: any, body: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = validateOptionalUuid('departmentId', body?.departmentId);
    // A department's budget is prepared by its leaders; the Treasurer may also prepare one on its behalf.
    if (departmentId && this.scope.isTreasurer(user)) await this.scope.department(user, departmentId);
    else if (departmentId) await this.scope.requireManage(user, departmentId);
    else await this.scope.requireManage(user, null, { central: ['treasurer', 'secretary'] });

    const title = validateText('title', body?.title, 200, true) as string;
    const description = validateText('description', body?.description, 1000);
    const fiscalYear = validateFiscalYear(body?.fiscalYear);
    const budgetType = (validateText('budgetType', body?.budgetType, 20) ?? (departmentId ? 'department' : 'annual')) as string;
    if (!BUDGET_TYPES.includes(budgetType)) throw new BadRequestException(`budgetType must be one of: ${BUDGET_TYPES.join(', ')}`);
    const projectId = validateOptionalUuid('projectId', body?.projectId);
    const activityId = validateOptionalUuid('activityId', body?.activityId);
    const callId = validateOptionalUuid('budgetCallId', body?.budgetCallId);
    const periodStart = validateDate('periodStart', body?.periodStart, { required: false, maxFutureDays: 3650 });
    const periodEnd = validateDate('periodEnd', body?.periodEnd, { required: false, maxFutureDays: 3650 });
    if (periodStart && periodEnd && periodStart > periodEnd) throw new BadRequestException('periodStart cannot be after periodEnd');
    if (projectId) await assertProjectForScope(this.prisma, projectId, fellowshipId, departmentId);
    if (activityId) {
      const a = await this.prisma.activity.findFirst({ where: { id: activityId, fellowship_id: fellowshipId }, select: { id: true } });
      if (!a) throw new BadRequestException('The selected activity is not available.');
    }
    let call: any = null;
    if (callId) {
      call = await this.prisma.budgetCall.findFirst({ where: { id: callId, fellowship_id: fellowshipId } });
      if (!call || call.status !== 'open') throw new BadRequestException('That budget call is not open.');
      if (!departmentId || (!call.all_departments && !(call.department_ids as string[]).includes(departmentId))) {
        throw new BadRequestException('That budget call is not addressed to this department.');
      }
      const existing = await this.prisma.budget.findFirst({ where: { budget_call_id: callId, department_id: departmentId, approval_status: { notIn: ['REJECTED', 'CANCELLED'] } } });
      if (existing) throw new ConflictException('This department has already submitted a budget for this call.');
    }
    const parsed = body?.lines !== undefined ? await this.parseLines(body.lines, fellowshipId) : null;
    const amount = parsed ? parsed.total.toFixed(2) : validateAmount('amount', body?.amount);
    const workflow = departmentId ? 'department_budget' : 'budget';

    const { budget, approval } = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, fellowshipId, 'budget', 'BGT');
      const b = await tx.budget.create({
        data: {
          fellowship_id: fellowshipId, department_id: departmentId, title, description, fiscal_year: fiscalYear, amount,
          budget_type: budgetType, project_id: projectId, activity_id: activityId, budget_call_id: callId,
          period_start: periodStart ?? call?.period_start ?? null, period_end: periodEnd ?? call?.period_end ?? null,
          budget_number: number, created_by: user.userId, approval_status: 'SUBMITTED',
        },
      });
      if (parsed) {
        let i = 0;
        for (const l of parsed.lines) {
          await tx.budgetLineItem.create({ data: { budget_id: b.id, name: l.name, category_id: l.categoryId, amount: l.amount, notes: l.notes, sort_order: i++ } });
        }
      }
      const wf = await this.engine.createWorkflow(workflow, b.id, 'budget', user.userId, { departmentId, amount }, fellowshipId, tx, { preparedByTreasurer: this.scope.isTreasurer(user) });
      await tx.budget.update({ where: { id: b.id }, data: { approval_workflow_id: wf.id } });
      const submitted = await this.engine.submit(wf.id, tx, user.userId);
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.budget_create', entity_type: 'budget', entity_id: b.id, fellowship_id: fellowshipId, new_value: { amount, title, fiscalYear, departmentId, lines: parsed?.lines.length ?? 0 } as any } });
      return { budget: b, approval: submitted };
    });
    await this.notify.stage(approval, 'budget', 'budget', budget.id, user.userId);
    return this.detail(user, budget.id);
  }

  async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Budget not found');
    const b = await this.prisma.budget.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!b) throw new NotFoundException('Budget not found');
    await this.scope.requireView(user, b.department_id);
    return b;
  }

  async detail(user: any, id: string) {
    const b = await this.load(user, id);
    const settings = await getSettings(this.prisma as any, b.fellowship_id!);
    const [performance, revisions, approval, department, project] = await Promise.all([
      budgetPerformance(this.prisma, id, settings.budget_warning_percent),
      this.prisma.budgetRevision.findMany({ where: { budget_id: id }, orderBy: { created_at: 'desc' } }),
      b.approval_workflow_id ? this.prisma.approval.findUnique({ where: { id: b.approval_workflow_id }, include: { steps: { orderBy: { stage_order: 'asc' } } } }) : null,
      b.department_id ? this.prisma.department.findUnique({ where: { id: b.department_id }, select: { id: true, name: true } }) : null,
      b.project_id ? this.prisma.project.findUnique({ where: { id: b.project_id }, select: { id: true, name: true, project_number: true } }) : null,
    ]);
    const spent = D(performance.totals.spent);
    const committed = D(performance.totals.committed);
    return {
      ...b, amount: money(b.amount), department, project,
      lines: performance.lines,
      position: {
        approved: b.approval_status === 'FINAL_APPROVED' ? money(b.amount) : '0.00',
        spent: spent.toFixed(2), committed: committed.toFixed(2),
        remaining: D(b.amount).minus(spent).minus(committed).toFixed(2),
        utilisationPercent: D(b.amount).isZero() ? 0 : Math.round(spent.plus(committed).div(b.amount).times(100).toNumber()),
      },
      revisions: revisions.map((r) => ({ ...r, proposed_amount: money(r.proposed_amount), previous_amount: r.previous_amount ? money(r.previous_amount) : null })),
      workflow: approval ? { id: approval.id, type: approval.workflow_type, status: approval.status, currentStage: approval.current_stage, steps: approval.steps } : null,
      history: approval ? await this.engine.history(approval.id) : [],
    };
  }

  /** Approved budgets that spending can be charged to, with their open lines (for forms). */
  async chargeable(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = q?.departmentId && q.departmentId !== 'central' ? q.departmentId : null;
    await this.scope.requireView(user, departmentId);
    const rows = await this.prisma.budget.findMany({
      where: { fellowship_id: fellowshipId, department_id: departmentId, approval_status: 'FINAL_APPROVED' },
      include: { lines: { where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, name: true, amount: true } } },
      orderBy: { created_at: 'desc' }, take: 50,
    });
    return rows.map((b) => ({ id: b.id, title: b.title, number: b.budget_number, fiscalYear: b.fiscal_year, lines: b.lines.map((l) => ({ ...l, amount: money(l.amount) })) }));
  }

  async proposeRevision(user: any, id: string, body: any) {
    const b = await this.load(user, id);
    await this.scope.requireManage(user, b.department_id, b.department_id ? {} : { central: ['treasurer'] });
    if (b.approval_status !== 'FINAL_APPROVED') throw new ConflictException('Only an approved budget can be revised; change a pending one by returning it.');
    const reason = validateText('reason', body?.reason, 500, true) as string;
    const parsed = await this.parseLines(body?.lines, b.fellowship_id!, true);
    const pending = await this.prisma.budgetRevision.findFirst({ where: { budget_id: id, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'RETURNED'] } } });
    if (pending) throw new ConflictException('This budget already has a revision waiting for approval.');
    // Lines already charged cannot be dropped below what has been spent or committed on them.
    const perf = await budgetPerformance(this.prisma, id);
    for (const used of perf.lines.filter((l) => l.isActive)) {
      const proposed = parsed.lines.find((l) => l.id === used.id);
      const floor = D(used.spent).plus(used.committed);
      if (floor.greaterThan(0) && (!proposed || D(proposed.amount).lessThan(floor))) {
        throw new BadRequestException(`"${used.name}" already has ${floor.toFixed(2)} spent or committed; it cannot be reduced below that.`);
      }
    }
    const { revision, approval } = await this.prisma.$transaction(async (tx) => {
      const r = await tx.budgetRevision.create({
        data: { fellowship_id: b.fellowship_id, budget_id: id, from_version: b.version, reason, proposed_lines: parsed.lines as unknown as Prisma.InputJsonValue, proposed_amount: parsed.total.toFixed(2), created_by: user.userId },
      });
      const wf = await this.engine.createWorkflow('budget_revision', r.id, 'budget_revision', user.userId, { budgetId: id, departmentId: b.department_id, reason }, b.fellowship_id, tx, { preparedByTreasurer: this.scope.isTreasurer(user) });
      await tx.budgetRevision.update({ where: { id: r.id }, data: { approval_workflow_id: wf.id } });
      const submitted = await this.engine.submit(wf.id, tx, user.userId);
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.budget_revision_proposed', entity_type: 'budget', entity_id: id, fellowship_id: b.fellowship_id, comment: reason, new_value: { from: money(b.amount), to: parsed.total.toFixed(2) } as any } });
      return { revision: r, approval: submitted };
    });
    await this.notify.stage(approval, 'budget revision', 'budget', id, user.userId);
    return { ...revision, proposed_amount: money(revision.proposed_amount) };
  }

  // ===================== budget calls (Secretary -> departments) =====================

  async createCall(user: any, body: any) {
    if (!this.scope.isSecretary(user)) throw new ForbiddenException('Only the Fellowship Secretary issues budget instructions.');
    const fellowshipId = this.scope.fellowship(user);
    const title = validateText('title', body?.title, 200, true) as string;
    const fiscalYear = validateFiscalYear(body?.fiscalYear);
    const periodStart = validateDate('periodStart', body?.periodStart, { maxFutureDays: 3650 }) as Date;
    const periodEnd = validateDate('periodEnd', body?.periodEnd, { maxFutureDays: 3650 }) as Date;
    if (periodStart > periodEnd) throw new BadRequestException('periodStart cannot be after periodEnd');
    const deadline = validateDate('deadline', body?.deadline, { maxFutureDays: 3650 }) as Date;
    const instructions = validateText('instructions', body?.instructions, 3000);
    const all = body?.allDepartments !== false;
    let ids: string[] = [];
    if (!all) {
      if (!Array.isArray(body?.departmentIds) || !body.departmentIds.length) throw new BadRequestException('Choose the departments that must submit.');
      ids = Array.from(new Set(body.departmentIds as string[]));
      const found = await this.prisma.department.count({ where: { id: { in: ids.filter(isUuid) }, fellowship_id: fellowshipId } });
      if (found !== ids.length) throw new BadRequestException('One of the departments is not available.');
    }
    const call = await this.prisma.budgetCall.create({ data: { fellowship_id: fellowshipId, title, fiscal_year: fiscalYear, period_start: periodStart, period_end: periodEnd, deadline, instructions, all_departments: all, department_ids: ids, created_by: user.userId } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.budget_call_create', entity_type: 'budget_call', entity_id: call.id, fellowship_id: fellowshipId } });
    const depts = all ? (await this.prisma.department.findMany({ where: { fellowship_id: fellowshipId, is_active: true }, select: { id: true } })).map((d) => d.id) : ids;
    const leaders = (await Promise.all(depts.map((d) => this.scope.departmentLeaderIds(d)))).flat();
    await this.notify.send(leaders, { eventType: 'budget_call', title: 'Budget submission requested', message: `Submit your ${fiscalYear} budget by ${deadline.toISOString().slice(0, 10)}.`, entityType: 'budget_call', entityId: call.id, fellowshipId }, user.userId);
    return call;
  }

  async listCalls(user: any) {
    const fellowshipId = this.scope.fellowship(user);
    const calls = await this.prisma.budgetCall.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { created_at: 'desc' }, take: 50 });
    if (this.scope.isCentralViewer(user)) return calls;
    const led = Array.from((await this.scope.leaderships(user)).keys());
    if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
    return calls.filter((c) => c.all_departments || (c.department_ids as string[]).some((d) => led.includes(d)));
  }

  /** Per department: submitted or not, its budget's approval status, and whether it was late. */
  async callStatus(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!this.scope.isCentralViewer(user)) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!isUuid(id)) throw new NotFoundException('Budget call not found');
    const call = await this.prisma.budgetCall.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!call) throw new NotFoundException('Budget call not found');
    const depts = await this.prisma.department.findMany({
      where: { fellowship_id: fellowshipId, ...(call.all_departments ? { is_active: true } : { id: { in: call.department_ids as string[] } }) },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
    const budgets = await this.prisma.budget.findMany({ where: { budget_call_id: id }, select: { id: true, department_id: true, approval_status: true, created_at: true, amount: true, budget_number: true } });
    return {
      call,
      departments: depts.map((d) => {
        const b = budgets.filter((x) => x.department_id === d.id).sort((a, z) => +z.created_at - +a.created_at)[0];
        return { departmentId: d.id, name: d.name, submitted: !!b, budgetId: b?.id ?? null, number: b?.budget_number ?? null, status: b?.approval_status ?? 'NOT_SUBMITTED', amount: b ? money(b.amount) : null, late: b ? b.created_at > call.deadline : new Date() > call.deadline };
      }),
    };
  }

  async closeCall(user: any, id: string) {
    if (!this.scope.isSecretary(user)) throw new ForbiddenException('Only the Fellowship Secretary manages budget instructions.');
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Budget call not found');
    const done = await this.prisma.budgetCall.updateMany({ where: { id, fellowship_id: fellowshipId, status: 'open' }, data: { status: 'closed' } });
    if (done.count !== 1) throw new ConflictException('This budget call is not open.');
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.budget_call_close', entity_type: 'budget_call', entity_id: id, fellowship_id: fellowshipId } });
    return this.prisma.budgetCall.findUnique({ where: { id } });
  }
}
