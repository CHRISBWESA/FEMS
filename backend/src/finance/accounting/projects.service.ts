import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAttachments } from '../../department-workspace/department.util';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance.validation';
import { D, money, nextNumber } from './ledger';
import { generalFundPosition, projectFinancials } from './project-finance';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';
import { parsePage } from './accounts.service';

const SOURCE_TYPES = ['contributions', 'general_fund', 'grant', 'sponsorship', 'fundraising', 'department', 'other'];
const PROJECT_CREATORS = ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer'];

/**
 * Projects. Fellowship-wide projects are central finances even when a department coordinates them; department
 * projects belong to that department's finances. Approval: Treasurer (budget review) -> Fellowship Secretary ->
 * Fellowship Chairperson. A project is not active - and cannot receive or spend money - until approved.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: FinanceScopeService,
    private notify: FinanceNotifyService,
  ) {}

  private async canCreate(user: any, scope: string, departmentId: string | null, coordinatingId: string | null) {
    if (this.scope.has(user, ...PROJECT_CREATORS)) return;
    // Department Chairpersons create projects for their department, or coordinate fellowship-wide ones.
    const dept = scope === 'department' ? departmentId : coordinatingId;
    if (dept && (await this.scope.leaderRole(user, dept)) === 'department_chairperson') return;
    throw new ForbiddenException('Only the Fellowship Secretary, Chairperson, Treasurer or a Department Chairperson can create projects.');
  }

  private async fields(user: any, body: any, fellowshipId: string, partial = false) {
    const d: any = {};
    if (!partial || body?.name !== undefined) d.name = validateText('name', body?.name, 200, true);
    if (!partial || body?.purpose !== undefined) d.purpose = validateText('purpose', body?.purpose, 1000, true);
    if (body?.description !== undefined) d.description = validateText('description', body.description, 5000);
    if (body?.projectType !== undefined) d.project_type = validateText('projectType', body.projectType, 100);
    if (body?.location !== undefined) d.location = validateText('location', body.location, 200);
    if (body?.startDate !== undefined) d.start_date = validateDate('startDate', body.startDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (body?.endDate !== undefined) d.end_date = validateDate('endDate', body.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (d.start_date && d.end_date && d.start_date > d.end_date) throw new BadRequestException('startDate cannot be after endDate');
    if (!partial || body?.budgetAmount !== undefined) d.budget_amount = validateAmount('budgetAmount', body?.budgetAmount);
    if (body?.attachments !== undefined) d.attachments = validateAttachments('attachments', body.attachments);
    if (body?.coordinatorMemberId !== undefined) {
      const id = validateOptionalUuid('coordinatorMemberId', body.coordinatorMemberId);
      if (id && !(await this.prisma.member.findFirst({ where: { id, fellowship_id: fellowshipId }, select: { id: true } }))) throw new BadRequestException('The coordinator must be a registered member.');
      d.coordinator_member_id = id;
    }
    return d;
  }

  private parseSources(list: unknown) {
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > 20) throw new BadRequestException('fundingSources must be a list of at most 20');
    return list.map((s: any) => {
      if (!SOURCE_TYPES.includes(s?.sourceType)) throw new BadRequestException(`sourceType must be one of: ${SOURCE_TYPES.join(', ')}`);
      return { source_type: s.sourceType, name: validateText('source name', s?.name, 150, true) as string, expected_amount: validateAmount('expectedAmount', s?.expectedAmount ?? 0, { allowZero: true }), notes: validateText('notes', s?.notes, 300) };
    });
  }

  async create(user: any, body: any) {
    const fellowshipId = this.scope.fellowship(user);
    const scope = body?.scope === 'department' ? 'department' : 'fellowship';
    const departmentId = validateOptionalUuid('departmentId', body?.departmentId);
    const coordinatingId = validateOptionalUuid('coordinatingDepartmentId', body?.coordinatingDepartmentId);
    if (scope === 'department' && !departmentId) throw new BadRequestException('Choose the department that owns this project.');
    if (departmentId) await this.scope.department(user, departmentId);
    if (coordinatingId) await this.scope.department(user, coordinatingId);
    await this.canCreate(user, scope, departmentId, coordinatingId);
    const data = await this.fields(user, body, fellowshipId);
    const sources = this.parseSources(body?.fundingSources) ?? [];
    const project = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, fellowshipId, 'project', 'PRJ');
      const p = await tx.project.create({
        data: { ...data, fellowship_id: fellowshipId, project_number: number, scope, department_id: scope === 'department' ? departmentId : null, coordinating_department_id: scope === 'fellowship' ? coordinatingId : null, created_by: user.userId },
      });
      for (const s of sources) await tx.projectFundingSource.create({ data: { ...s, project_id: p.id } });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'project.create', entity_type: 'project', entity_id: p.id, fellowship_id: fellowshipId, new_value: { name: p.name, scope, budget: money(p.budget_amount) } as any } });
      return p;
    });
    if (body?.submit === true) return this.submit(user, project.id);
    return this.detail(user, project.id);
  }

  async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Project not found');
    const p = await this.prisma.project.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** Fellowship-wide projects are visible to central officers and every department leader; department projects to that department. */
  private async assertView(user: any, p: any) {
    if (this.scope.isCentralViewer(user) || p.created_by === user.userId) return;
    const led = await this.scope.leaderships(user);
    if (p.scope === 'fellowship' && led.size) return;
    if (p.department_id && led.has(p.department_id)) return;
    throw new ForbiddenException('You do not have access to this project.');
  }

  /** May this user change the project (drafts, status)? Its creator, the coordinating department's chair, or the Secretary. */
  private async assertManage(user: any, p: any) {
    if (p.created_by === user.userId || this.scope.isSecretary(user)) return;
    const dept = p.scope === 'department' ? p.department_id : p.coordinating_department_id;
    if (dept && (await this.scope.leaderRole(user, dept)) === 'department_chairperson') return;
    throw new ForbiddenException('Only the project\'s creator, its department\'s Chairperson or the Fellowship Secretary can do this.');
  }

  async list(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const { take, skip, page, limit } = parsePage(q);
    const where: any = { fellowship_id: fellowshipId };
    if (!this.scope.isCentralViewer(user)) {
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
      where.OR = [{ scope: 'fellowship' }, { department_id: { in: led } }, { created_by: user.userId }];
    }
    if (q?.status) where.status = String(q.status).toUpperCase();
    if (q?.scope === 'department' || q?.scope === 'fellowship') where.scope = q.scope;
    if (q?.departmentId && isUuid(q.departmentId)) where.AND = [{ OR: [{ department_id: q.departmentId }, { coordinating_department_id: q.departmentId }] }];
    if (q?.search) where.name = { contains: validateText('search', q.search, 100), mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.project.count({ where }),
    ]);
    const data = await Promise.all(rows.map(async (p) => ({ ...p, budget_amount: money(p.budget_amount), financials: await projectFinancials(this.prisma, p) })));
    return { data, total, page, limit };
  }

  /** The project dashboard: budget, funding by source, spending, commitments, pledges and history. */
  async detail(user: any, id: string) {
    const p = await this.load(user, id);
    await this.assertView(user, p);
    const [financials, sources, allocations, contributions, income, expenses, pledges, campaigns, budgets, department, coordinating, coordinator] = await Promise.all([
      projectFinancials(this.prisma, p),
      this.prisma.projectFundingSource.findMany({ where: { project_id: id } }),
      this.prisma.projectAllocation.findMany({ where: { project_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.contributionAllocation.findMany({ where: { project_id: id, is_active: true, contribution: { status: 'active' } }, orderBy: { created_at: 'desc' }, take: 50, include: { contribution: { select: { receipt_number: true, date: true, contributor_type: true } } } }),
      this.prisma.incomeRecord.findMany({ where: { project_id: id, status: 'active' }, orderBy: { date: 'desc' }, take: 50, select: { id: true, title: true, amount: true, date: true, funding_source: true, source: true } }),
      this.prisma.expense.findMany({ where: { project_id: id }, orderBy: { date: 'desc' }, take: 100, select: { id: true, expense_number: true, title: true, amount: true, amount_paid: true, payment_status: true, approval_status: true, date: true, budget_line_id: true } }),
      this.prisma.contributionPledge.findMany({ where: { project_id: id }, select: { id: true, pledge_number: true, amount: true, amount_fulfilled: true, status: true, due_date: true } }),
      this.prisma.contributionCampaign.findMany({ where: { project_id: id }, select: { id: true, name: true, status: true, target_amount: true, is_public: true } }),
      this.prisma.budget.findMany({ where: { project_id: id }, select: { id: true, title: true, budget_number: true, amount: true, approval_status: true } }),
      p.department_id ? this.prisma.department.findUnique({ where: { id: p.department_id }, select: { id: true, name: true } }) : null,
      p.coordinating_department_id ? this.prisma.department.findUnique({ where: { id: p.coordinating_department_id }, select: { id: true, name: true } }) : null,
      p.coordinator_member_id ? this.prisma.member.findUnique({ where: { id: p.coordinator_member_id }, select: { id: true, full_name: true } }) : null,
    ]);
    // Funding by source: what was planned against what actually arrived.
    const actualBySource: Record<string, string> = {
      contributions: financials.contributions,
      general_fund: financials.generalFundAllocations,
      grant: money(income.filter((i) => (i.funding_source ?? '').toLowerCase() === 'grant').reduce((s, i) => s.plus(i.amount), D(0))),
    };
    const [approvalHistory, closureHistory] = await Promise.all([
      p.approval_workflow_id ? this.engine.history(p.approval_workflow_id) : [],
      p.closure_workflow_id ? this.engine.history(p.closure_workflow_id) : [],
    ]);
    const workflowId = p.status === 'PENDING_APPROVAL' ? p.approval_workflow_id : p.closure_status === 'pending' ? p.closure_workflow_id : null;
    const workflow = workflowId ? await this.prisma.approval.findUnique({ where: { id: workflowId }, include: { steps: { orderBy: { stage_order: 'asc' } } } }) : null;
    return {
      ...p, budget_amount: money(p.budget_amount), department, coordinatingDepartment: coordinating, coordinator,
      financials,
      fundingSources: sources.map((s) => ({ ...s, expected_amount: money(s.expected_amount), actual: actualBySource[s.source_type] ?? null })),
      fundAllocations: allocations.map((a) => ({ ...a, amount: money(a.amount) })),
      contributions: contributions.map((c) => ({ id: c.id, amount: money(c.amount), receipt: c.contribution.receipt_number, date: c.contribution.date, contributorType: c.contribution.contributor_type })),
      income: income.map((i) => ({ ...i, amount: money(i.amount) })),
      expenses: expenses.map((e) => ({ ...e, amount: money(e.amount), amount_paid: e.amount_paid ? money(e.amount_paid) : null })),
      pledges: pledges.map((x) => ({ ...x, amount: money(x.amount), amount_fulfilled: money(x.amount_fulfilled) })),
      campaigns: campaigns.map((c) => ({ ...c, target_amount: c.target_amount ? money(c.target_amount) : null })),
      budgets: budgets.map((b) => ({ ...b, amount: money(b.amount) })),
      workflow: workflow ? { id: workflow.id, type: workflow.workflow_type, status: workflow.status, currentStage: workflow.current_stage, steps: workflow.steps } : null,
      approvalHistory, closureHistory,
    };
  }

  async update(user: any, id: string, body: any) {
    const p = await this.load(user, id);
    await this.assertManage(user, p);
    if (!['DRAFT', 'RETURNED'].includes(p.status)) throw new ConflictException('Only a draft or returned project can be edited.');
    const data = await this.fields(user, body, p.fellowship_id, true);
    const sources = this.parseSources(body?.fundingSources);
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data });
      if (sources) {
        await tx.projectFundingSource.deleteMany({ where: { project_id: id } });
        for (const s of sources) await tx.projectFundingSource.create({ data: { ...s, project_id: id } });
      }
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'project.update', entity_type: 'project', entity_id: id, fellowship_id: p.fellowship_id, new_value: { fields: Object.keys(data) } as any } });
    });
    return this.detail(user, id);
  }

  async submit(user: any, id: string) {
    const p = await this.load(user, id);
    await this.assertManage(user, p);
    if (p.status !== 'DRAFT' && p.status !== 'RETURNED') throw new ConflictException('This project has already been submitted.');
    const approval = await this.prisma.$transaction(async (tx) => {
      if (p.status === 'RETURNED' && p.approval_workflow_id) {
        return this.engine.resubmit(p.approval_workflow_id, user.userId, this.scope.roles(user), { anyRequester: true, db: tx });
      }
      const wf = await this.engine.createWorkflow('project', p.id, 'project', user.userId, { scope: p.scope, departmentId: null, budget: money(p.budget_amount) }, p.fellowship_id, tx, { preparedByTreasurer: this.scope.isTreasurer(user) });
      await tx.project.update({ where: { id }, data: { approval_workflow_id: wf.id, submitted_at: new Date(), status: 'PENDING_APPROVAL' } });
      return this.engine.submit(wf.id, tx, user.userId);
    });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'project.submit', entity_type: 'project', entity_id: id, fellowship_id: p.fellowship_id } });
    await this.notify.stage(approval, 'project', 'project', id, user.userId);
    return this.detail(user, id);
  }

  /** Approved -> Active -> On hold / Completed. Closure is a separate, approved step. */
  async setStatus(user: any, id: string, body: any) {
    const p = await this.load(user, id);
    await this.assertManage(user, p);
    const next = String(body?.status ?? '').toUpperCase();
    const allowed: Record<string, string[]> = { APPROVED: ['ACTIVE'], ACTIVE: ['ON_HOLD', 'COMPLETED'], ON_HOLD: ['ACTIVE', 'COMPLETED'], COMPLETED: ['ACTIVE'] };
    if (!(allowed[p.status] ?? []).includes(next)) throw new ConflictException(`A ${p.status.toLowerCase().replace('_', ' ')} project cannot become ${next.toLowerCase().replace('_', ' ')}.`);
    const reason = validateText('reason', body?.reason, 300);
    const done = await this.prisma.project.updateMany({ where: { id, status: p.status }, data: { status: next as any } });
    if (done.count !== 1) throw new ConflictException('The project changed; refresh and try again.');
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'project.status', entity_type: 'project', entity_id: id, fellowship_id: p.fellowship_id, old_value: { status: p.status } as any, new_value: { status: next } as any, comment: reason } });
    return this.detail(user, id);
  }

  /** The Treasurer earmarks General Fund money for a fellowship-wide project (Secretary -> Chairperson approve). */
  async requestAllocation(user: any, id: string, body: any) {
    await this.scope.requireManage(user, null);
    const p = await this.load(user, id);
    if (p.scope !== 'fellowship') throw new BadRequestException('Only fellowship-wide projects are funded from the General Fund.');
    if (!['APPROVED', 'ACTIVE'].includes(p.status)) throw new ConflictException('The project must be approved before money is allocated to it.');
    const amount = D(validateAmount('amount', body?.amount));
    const notes = validateText('notes', body?.notes, 300);
    const gf = await generalFundPosition(this.prisma, p.fellowship_id);
    if (D(gf.available).lessThan(amount)) throw new ConflictException(`The General Fund has ${gf.available} available.`);
    const { alloc, approval } = await this.prisma.$transaction(async (tx) => {
      const a = await tx.projectAllocation.create({ data: { fellowship_id: p.fellowship_id, allocation_number: await nextNumber(tx, p.fellowship_id, 'allocation', 'ALC'), project_id: id, kind: 'general_fund_allocation', amount: amount.toFixed(2), notes, created_by: user.userId } });
      const wf = await this.engine.createWorkflow('project_allocation', a.id, 'project_allocation', user.userId, { projectId: id, amount: amount.toFixed(2) }, p.fellowship_id, tx);
      await tx.projectAllocation.update({ where: { id: a.id }, data: { approval_workflow_id: wf.id } });
      return { alloc: a, approval: await this.engine.submit(wf.id, tx, user.userId) };
    });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'project.allocation_requested', entity_type: 'project', entity_id: id, fellowship_id: p.fellowship_id, new_value: { amount: amount.toFixed(2) } as any } });
    await this.notify.stage(approval, 'General Fund allocation', 'project', id, user.userId);
    return { ...alloc, amount: money(alloc.amount) };
  }

  /**
   * Closure: the coordinator submits the final report; Treasurer verifies the money -> Secretary reviews ->
   * Chairperson approves. Unspent money is returned to the General Fund or carried forward to another project.
   */
  async requestClosure(user: any, id: string, body: any) {
    const p = await this.load(user, id);
    await this.assertManage(user, p);
    if (!['ACTIVE', 'COMPLETED', 'ON_HOLD', 'APPROVED'].includes(p.status)) throw new ConflictException('Only an approved project can be closed.');
    if (p.closure_status === 'pending') throw new ConflictException('A closure request is already waiting for approval.');
    const finalReport = validateText('finalReport', body?.finalReport, 10000, true) as string;
    const disposition = body?.unspentDisposition === 'carry_forward' ? 'carry_forward' : 'return_to_general_fund';
    const carryTo = disposition === 'carry_forward' ? validateOptionalUuid('carryForwardProjectId', body?.carryForwardProjectId) : null;
    if (disposition === 'carry_forward') {
      if (!carryTo || carryTo === id) throw new BadRequestException('Choose the project the unspent money carries forward to.');
      const t = await this.prisma.project.findFirst({ where: { id: carryTo, fellowship_id: p.fellowship_id, scope: p.scope, department_id: p.department_id, status: { in: ['APPROVED', 'ACTIVE'] } } });
      if (!t) throw new BadRequestException('That project cannot receive the carried-forward money.');
    }
    // Before closing: nothing may still be waiting for payment or approval.
    const f = await projectFinancials(this.prisma, p);
    if (D(f.commitments).greaterThan(0)) throw new ConflictException('The project still has approved payments that have not been made.');
    const pendingExpenses = await this.prisma.expense.count({ where: { project_id: id, approval_status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'RETURNED'] }, reversed_at: null } });
    const pendingRequests = await this.prisma.moneyRequest.count({ where: { project_id: id, approval_status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'RETURNED'] } } });
    if (pendingExpenses || pendingRequests) throw new ConflictException('Resolve the project\'s outstanding expenses and money requests before closing it.');

    const approval = await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { final_report: finalReport, unspent_disposition: disposition, carry_forward_project_id: carryTo } });
      if (p.closure_workflow_id && ['returned', 'rejected'].includes(p.closure_status ?? '')) {
        await tx.project.update({ where: { id }, data: { closure_status: 'pending' } });
        return this.engine.resubmit(p.closure_workflow_id, user.userId, this.scope.roles(user), { anyRequester: true, db: tx });
      }
      const wf = await this.engine.createWorkflow('project_closure', id, 'project', user.userId, { unspent: f.unspentFunds, disposition }, p.fellowship_id, tx, { preparedByTreasurer: this.scope.isTreasurer(user) });
      await tx.project.update({ where: { id }, data: { closure_workflow_id: wf.id, closure_status: 'pending' } });
      return this.engine.submit(wf.id, tx, user.userId);
    });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'project.closure_requested', entity_type: 'project', entity_id: id, fellowship_id: p.fellowship_id, new_value: { unspent: f.unspentFunds, disposition } as any } });
    await this.notify.stage(approval, 'project closure', 'project', id, user.userId);
    return this.detail(user, id);
  }

  /** Approved/active projects that money can go to (for forms). */
  async fundable(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = q?.departmentId && q.departmentId !== 'central' ? q.departmentId : null;
    await this.scope.requireView(user, departmentId);
    const rows = await this.prisma.project.findMany({
      where: { fellowship_id: fellowshipId, status: { in: ['APPROVED', 'ACTIVE'] }, ...(departmentId ? { scope: 'department', department_id: departmentId } : { scope: 'fellowship' }) },
      select: { id: true, name: true, project_number: true, budget_amount: true }, orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({ ...r, budget_amount: money(r.budget_amount) }));
  }
}
