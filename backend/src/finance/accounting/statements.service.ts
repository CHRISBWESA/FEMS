import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateText } from '../finance.validation';
import { D, getSettings, money, ZERO } from './ledger';
import { budgetPerformance } from './budget-math';
import { feeDueDates } from './contributions-core.service';
import { generalFundPosition, projectFinancials } from './project-finance';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceApprovalsService } from './finance-approvals.service';
import { Report, ReportColumn } from './exporters';
import { range } from './accounts.service';

export const REPORTS: { key: string; title: string; centralOnly?: boolean }[] = [
  { key: 'income-expenditure', title: 'Income and expenditure statement' },
  { key: 'cash-position', title: 'Cash position' },
  { key: 'account-balances', title: 'Account balances' },
  { key: 'contributions', title: 'Contributions report' },
  { key: 'membership-fees', title: 'Membership fee collection' },
  { key: 'expenses', title: 'Expense report' },
  { key: 'budget-performance', title: 'Budget performance' },
  { key: 'projects', title: 'Project financial report' },
  { key: 'departments', title: 'Department financial report', centralOnly: true },
  { key: 'funding-sources', title: 'Funding source report' },
  { key: 'transfers', title: 'Transfer report' },
  { key: 'audit', title: 'Financial audit report', centralOnly: true },
];

const MAX_ROWS = 5000;
const col = (key: string, label: string, money = false): ReportColumn => ({ key, label, money, align: money ? 'right' : 'left' });
const SOURCE_INCOME = ['contribution', 'income'];
const SOURCE_EXPENSE = ['expense', 'money_request_release'];

/**
 * Reports, the finance dashboard and the department transparency summary. Everything is computed from the records
 * and the ledger. Reports separate money actually received and paid from approvals not yet paid (commitments). Department leaders only ever get their own department's figures.
 */
@Injectable()
export class StatementsService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService, private approvals: FinanceApprovalsService) {}

  /** Resolves the report's scope: a department (leaders: must be theirs) or central. */
  private async reportScope(user: any, q: any): Promise<{ fellowshipId: string; departmentId: string | null; label: string }> {
    const fellowshipId = this.scope.fellowship(user);
    let departmentId: string | null = q?.departmentId && q.departmentId !== 'central' ? q.departmentId : null;
    if (departmentId && !isUuid(departmentId)) throw new BadRequestException('departmentId must be a valid id');
    if (q?.departmentId === 'central' && !this.scope.isCentralViewer(user)) throw new ForbiddenException('You do not have access to central fellowship finances.');
    if (!departmentId && !this.scope.isCentralViewer(user)) {
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (led.length !== 1) throw new ForbiddenException('Choose one of your departments.');
      departmentId = led[0];
    }
    await this.scope.requireView(user, departmentId);
    const dept = departmentId ? await this.prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } }) : null;
    return { fellowshipId, departmentId, label: dept ? dept.name : 'Central fellowship finances' };
  }

  list(user: any) {
    const central = this.scope.isCentralViewer(user);
    return REPORTS.filter((r) => central || !r.centralOnly);
  }

  async build(user: any, key: string, q: any): Promise<Report> {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new NotFoundException('Report not found');
    if (def.centralOnly && !this.scope.isCentralViewer(user)) throw new ForbiddenException('This report covers the whole fellowship.');
    const sc = await this.reportScope(user, def.centralOnly ? { ...q, departmentId: undefined } : q);
    const settings = await getSettings(this.prisma as any, sc.fellowshipId);
    const r = range(q);
    const period = r ? `${r.gte ? r.gte.toISOString().slice(0, 10) : 'start'} to ${r.lte ? r.lte.toISOString().slice(0, 10) : 'today'}` : 'all dates';
    const base: Report = { key, title: def.title, subtitle: `${def.centralOnly ? 'Whole fellowship' : sc.label} · ${period}`, generatedAt: new Date(), currency: settings.currency, summary: [], columns: [], rows: [] };
    const report = await (this as any)[`r_${key.replace(/-/g, '_')}`](sc, r, q, base, user);
    if (report.rows.length > MAX_ROWS) {
      report.notes = [...(report.notes ?? []), `Only the first ${MAX_ROWS} rows are shown; narrow the filters.`];
      report.rows = report.rows.slice(0, MAX_ROWS);
    }
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.report_generated', entity_type: 'report', fellowship_id: sc.fellowshipId, new_value: { key, departmentId: sc.departmentId, format: q?.format ?? 'json' } as any } });
    return report;
  }

  private ledgerWhere(sc: any, r: any): Prisma.LedgerEntryWhereInput {
    return { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, ...(r ? { entry_date: r } : {}) };
  }

  // ---------- 1. income and expenditure (cash basis: money actually received and paid, net of reversals) ----------
  private async r_income_expenditure(sc: any, r: any, _q: any, rep: Report) {
    const contribs = await this.prisma.contribution.groupBy({ by: ['contribution_type'], where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, status: 'active', ...(r ? { date: r } : {}) }, _sum: { amount: true } });
    const income = await this.prisma.incomeRecord.findMany({ where: { fellowship_id: sc.fellowshipId, status: 'active', account: { department_id: sc.departmentId }, ...(r ? { date: r } : {}) }, select: { amount: true, category: { select: { name: true } }, funding_source: true } });
    const paid = await this.prisma.expense.findMany({ where: { fellowship_id: sc.fellowshipId, payment_status: 'paid', reversed_at: null, account: { department_id: sc.departmentId }, ...(r ? { paid_at: r } : {}) }, select: { amount_paid: true, category: { select: { name: true } } } });
    const rows: any[] = [];
    let inT = ZERO, outT = ZERO;
    for (const c of contribs) { rows.push({ section: 'Income', item: `Contributions: ${c.contribution_type}`, amount: money(c._sum.amount) }); inT = inT.plus(c._sum.amount ?? 0); }
    const incBy = new Map<string, Prisma.Decimal>();
    for (const i of income) { const k = i.category?.name ?? i.funding_source ?? 'Other income'; incBy.set(k, (incBy.get(k) ?? ZERO).plus(i.amount)); }
    for (const [k, v] of incBy) { rows.push({ section: 'Income', item: k, amount: v.toFixed(2) }); inT = inT.plus(v); }
    const expBy = new Map<string, Prisma.Decimal>();
    for (const e of paid) { const k = e.category?.name ?? 'Uncategorised'; expBy.set(k, (expBy.get(k) ?? ZERO).plus(e.amount_paid ?? 0)); }
    for (const [k, v] of expBy) { rows.push({ section: 'Expenditure', item: k, amount: v.toFixed(2) }); outT = outT.plus(v); }
    return { ...rep, columns: [col('section', 'Section'), col('item', 'Item'), col('amount', 'Amount', true)], rows,
      summary: [{ label: 'Total income received', value: inT.toFixed(2) }, { label: 'Total expenditure paid', value: outT.toFixed(2) }, { label: 'Surplus / (deficit)', value: inT.minus(outT).toFixed(2) }],
      notes: ['Transfers between accounts and General Fund allocations are internal movements and are not income or expenditure. Approved-but-unpaid spending is excluded.'] };
  }

  // ---------- 2. cash position per account for the period ----------
  private async r_cash_position(sc: any, r: any, _q: any, rep: Report) {
    const accounts = await this.prisma.financialAccount.findMany({ where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId }, orderBy: { name: 'asc' } });
    const rows: any[] = [];
    let closingT = ZERO;
    for (const a of accounts) {
      const before = r?.gte ? await this.prisma.ledgerEntry.aggregate({ where: { account_id: a.id, entry_date: { lt: r.gte } }, _sum: { amount: true } }) : { _sum: { amount: null } };
      const inP = await this.prisma.ledgerEntry.aggregate({ where: { account_id: a.id, amount: { gt: 0 }, ...(r ? { entry_date: r } : {}) }, _sum: { amount: true } });
      const outP = await this.prisma.ledgerEntry.aggregate({ where: { account_id: a.id, amount: { lt: 0 }, ...(r ? { entry_date: r } : {}) }, _sum: { amount: true } });
      const opening = D(before._sum.amount);
      const closing = opening.plus(inP._sum.amount ?? 0).plus(outP._sum.amount ?? 0);
      closingT = closingT.plus(closing);
      rows.push({ account: a.name, type: a.account_type, opening: opening.toFixed(2), moneyIn: money(inP._sum.amount), moneyOut: money(D(outP._sum.amount).abs()), closing: closing.toFixed(2) });
    }
    return { ...rep, columns: [col('account', 'Account'), col('type', 'Type'), col('opening', 'Opening', true), col('moneyIn', 'Money in', true), col('moneyOut', 'Money out', true), col('closing', 'Closing', true)], rows,
      summary: [{ label: 'Total cash position', value: closingT.toFixed(2) }] };
  }

  private async r_account_balances(sc: any, _r: any, _q: any, rep: Report) {
    const accounts = await this.prisma.financialAccount.findMany({ where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId }, orderBy: { name: 'asc' } });
    const rows = accounts.map((a) => ({ account: a.name, type: a.account_type, reference: a.reference, status: a.is_active ? 'active' : 'inactive', reconciled: a.last_reconciled_at, balance: money(a.balance) }));
    const total = accounts.reduce((s, a) => s.plus(a.balance), ZERO);
    const summary = [{ label: 'Total balance', value: total.toFixed(2) }];
    if (!sc.departmentId) {
      const gf = await generalFundPosition(this.prisma, sc.fellowshipId);
      summary.push({ label: 'Earmarked for projects', value: gf.earmarkedForProjects }, { label: 'General Fund available', value: gf.available });
    }
    return { ...rep, columns: [col('account', 'Account'), col('type', 'Type'), col('reference', 'Reference'), col('status', 'Status'), col('reconciled', 'Last reconciled'), col('balance', 'Balance', true)], rows, totals: { balance: total.toFixed(2) }, summary };
  }

  private async r_contributions(sc: any, r: any, q: any, rep: Report) {
    const where: Prisma.ContributionWhereInput = { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, ...(r ? { date: r } : {}) };
    if (q?.status === 'reversed') where.status = 'reversed'; else if (q?.status !== 'all') where.status = 'active';
    if (q?.categoryId && isUuid(q.categoryId)) where.category_id = q.categoryId;
    if (q?.accountId && isUuid(q.accountId)) where.account_id = q.accountId;
    if (q?.paymentMethod) where.payment_method = validateText('paymentMethod', q.paymentMethod, 30);
    if (q?.projectId && isUuid(q.projectId)) where.allocations = { some: { project_id: q.projectId, is_active: true } };
    const rows = await this.prisma.contribution.findMany({ where, orderBy: { date: 'asc' }, take: MAX_ROWS + 1, include: { member: { select: { full_name: true } }, category: { select: { name: true } }, account: { select: { name: true } } } });
    const total = rows.reduce((s, c) => s.plus(c.status === 'active' ? c.amount : 0), ZERO);
    const byType = { member: 0, external: 0, anonymous: 0 } as Record<string, number>;
    rows.forEach((c) => { byType[c.contributor_type]++; });
    return { ...rep,
      columns: [col('receipt', 'Receipt'), col('date', 'Date'), col('contributor', 'Contributor'), col('purpose', 'Purpose'), col('method', 'Method'), col('account', 'Account'), col('status', 'Status'), col('amount', 'Amount', true)],
      rows: rows.map((c) => ({ receipt: c.receipt_number, date: c.date, contributor: c.contributor_type === 'anonymous' ? 'Anonymous' : c.member?.full_name ?? c.contributor_name, purpose: c.category?.name ?? c.contribution_type, method: c.payment_method, account: c.account?.name, status: c.status, amount: money(c.amount) })),
      totals: { amount: total.toFixed(2) },
      summary: [{ label: 'Contributions received (not reversed)', value: total.toFixed(2) }, { label: 'From members / external / anonymous', value: `${byType.member} / ${byType.external} / ${byType.anonymous}` }] };
  }

  private async r_membership_fees(sc: any, _r: any, _q: any, rep: Report) {
    if (!sc.departmentId) throw new BadRequestException('Membership fees belong to a department: choose one.');
    const fees = await this.prisma.membershipFee.findMany({ where: { department_id: sc.departmentId }, orderBy: { created_at: 'desc' } });
    const rows: any[] = [];
    let exp = ZERO, paid = ZERO;
    for (const f of fees) {
      const dues = feeDueDates(f, new Date());
      const eligible = f.eligible_member_ids as string[] | null;
      const members = await this.prisma.departmentMember.count({ where: { department_id: sc.departmentId, removed: false, ...(eligible ? { member_id: { in: eligible } } : {}) } });
      const expected = D(f.amount).times(dues.length).times(members);
      const collected = D((await this.prisma.contribution.aggregate({ where: { membership_fee_id: f.id, status: 'active' }, _sum: { amount: true } }))._sum.amount);
      exp = exp.plus(expected); paid = paid.plus(collected);
      rows.push({ fee: f.name, frequency: f.frequency, amount: money(f.amount), members, periods: dues.length, expected: expected.toFixed(2), collected: collected.toFixed(2), outstanding: Prisma.Decimal.max(expected.minus(collected), ZERO).toFixed(2), status: f.is_active ? 'active' : 'inactive' });
    }
    return { ...rep, columns: [col('fee', 'Fee'), col('frequency', 'Frequency'), col('amount', 'Per period', true), col('members', 'Members'), col('periods', 'Periods due'), col('expected', 'Expected', true), col('collected', 'Collected', true), col('outstanding', 'Outstanding', true)], rows,
      summary: [{ label: 'Expected to date', value: exp.toFixed(2) }, { label: 'Collected', value: paid.toFixed(2) }, { label: 'Outstanding', value: Prisma.Decimal.max(exp.minus(paid), ZERO).toFixed(2) }] };
  }

  private async r_expenses(sc: any, r: any, q: any, rep: Report) {
    const where: Prisma.ExpenseWhereInput = { fellowship_id: sc.fellowshipId, ...(r ? { date: r } : {}) };
    // A department's report covers its own spending and central spending made for it (e.g. paid money requests).
    if (sc.departmentId) where.OR = [{ account: { department_id: sc.departmentId } }, { department_id: sc.departmentId }];
    else where.OR = [{ account_id: null }, { account: { department_id: null } }];
    if (q?.categoryId && isUuid(q.categoryId)) where.category_id = q.categoryId;
    if (q?.projectId && isUuid(q.projectId)) where.project_id = q.projectId;
    if (q?.accountId && isUuid(q.accountId)) where.account_id = q.accountId;
    if (q?.paymentMethod) where.payment_method = validateText('paymentMethod', q.paymentMethod, 30);
    if (q?.status === 'paid') where.payment_status = 'paid';
    else if (q?.status === 'unpaid') { where.payment_status = 'unpaid'; where.approval_status = 'FINAL_APPROVED'; }
    else if (q?.status) where.approval_status = String(q.status).toUpperCase() as any;
    const rows = await this.prisma.expense.findMany({ where, orderBy: { date: 'asc' }, take: MAX_ROWS + 1, include: { category: { select: { name: true } }, account: { select: { name: true } } } });
    let paid = ZERO, committed = ZERO, requested = ZERO;
    const out = rows.map((e) => {
      const status = e.payment_status === 'paid' && !e.reversed_at ? 'paid' : e.reversed_at ? 'reversed/cancelled' : e.approval_status === 'FINAL_APPROVED' ? 'approved, unpaid' : e.approval_status.toLowerCase().replace('_', ' ');
      if (status === 'paid') paid = paid.plus(e.amount_paid ?? 0);
      else if (status === 'approved, unpaid') committed = committed.plus(e.amount_approved ?? e.amount);
      else if (['submitted', 'under review', 'resubmitted'].includes(status)) requested = requested.plus(e.amount);
      return { number: e.expense_number, date: e.date, title: e.title, category: e.category?.name, payee: e.payee, account: e.account?.name, status, requested: money(e.amount), paid: e.amount_paid && status === 'paid' ? money(e.amount_paid) : '' };
    });
    return { ...rep, columns: [col('number', 'Number'), col('date', 'Date'), col('title', 'Title'), col('category', 'Category'), col('payee', 'Payee'), col('account', 'Paid from'), col('status', 'Status'), col('requested', 'Amount', true), col('paid', 'Paid', true)], rows: out,
      totals: { paid: paid.toFixed(2) },
      summary: [{ label: 'Paid', value: paid.toFixed(2) }, { label: 'Approved but not yet paid (commitments)', value: committed.toFixed(2) }, { label: 'Waiting for approval', value: requested.toFixed(2) }] };
  }

  private async r_budget_performance(sc: any, _r: any, q: any, rep: Report) {
    const settings = await getSettings(this.prisma as any, sc.fellowshipId);
    const where: any = { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, approval_status: 'FINAL_APPROVED' };
    if (q?.budgetId && isUuid(q.budgetId)) where.id = q.budgetId;
    if (q?.fiscalYear) where.fiscal_year = validateText('fiscalYear', q.fiscalYear, 9);
    if (q?.projectId && isUuid(q.projectId)) where.project_id = q.projectId;
    const budgets = await this.prisma.budget.findMany({ where, orderBy: { created_at: 'desc' }, take: 50 });
    const rows: any[] = [];
    let a = ZERO, s = ZERO, c = ZERO;
    for (const b of budgets) {
      const perf = await budgetPerformance(this.prisma, b.id, settings.budget_warning_percent);
      if (!perf.lines.length) {
        const remaining = D(b.amount).minus(perf.totals.spent).minus(perf.totals.committed);
        rows.push({ budget: `${b.budget_number ?? ''} ${b.title}`.trim(), line: '(whole budget)', approved: money(b.amount), spent: perf.totals.spent, committed: perf.totals.committed, remaining: remaining.toFixed(2), used: D(b.amount).isZero() ? '' : `${Math.round(D(perf.totals.spent).plus(perf.totals.committed).div(b.amount).times(100).toNumber())}%` });
      }
      for (const l of perf.lines) rows.push({ budget: `${b.budget_number ?? ''} ${b.title}`.trim(), line: l.isActive ? l.name : `${l.name} (removed)`, approved: l.approved, spent: l.spent, committed: l.committed, remaining: l.remaining, used: `${l.utilisationPercent}%${l.overspent ? ' OVERSPENT' : l.warning ? ' warning' : ''}` });
      a = a.plus(b.amount); s = s.plus(perf.totals.spent); c = c.plus(perf.totals.committed);
    }
    return { ...rep, columns: [col('budget', 'Budget'), col('line', 'Line'), col('approved', 'Approved', true), col('spent', 'Spent', true), col('committed', 'Committed', true), col('remaining', 'Remaining', true), col('used', 'Used')], rows,
      summary: [{ label: 'Approved budgets', value: a.toFixed(2) }, { label: 'Actually spent', value: s.toFixed(2) }, { label: 'Approved, not yet paid', value: c.toFixed(2) }, { label: 'Remaining', value: a.minus(s).minus(c).toFixed(2) }] };
  }

  private async r_projects(sc: any, _r: any, q: any, rep: Report) {
    const where: any = { fellowship_id: sc.fellowshipId, ...(sc.departmentId ? { scope: 'department', department_id: sc.departmentId } : { scope: 'fellowship' }) };
    if (q?.projectId && isUuid(q.projectId)) where.id = q.projectId;
    const projects = await this.prisma.project.findMany({ where, orderBy: { created_at: 'desc' }, take: 200 });
    const rows: any[] = [];
    for (const p of projects) {
      const f = await projectFinancials(this.prisma, p);
      rows.push({ number: p.project_number, name: p.name, status: p.status, budget: f.budget, received: f.fundingReceived, paid: f.expensesPaid, committed: f.commitments, remaining: f.remainingBudget, progress: `${f.fundingProgressPercent}%` });
    }
    return { ...rep, columns: [col('number', 'Project'), col('name', 'Name'), col('status', 'Status'), col('budget', 'Budget', true), col('received', 'Funds received', true), col('paid', 'Paid', true), col('committed', 'Committed', true), col('remaining', 'Budget left', true), col('progress', 'Funded')], rows,
      notes: ['Funds received = contributions allocated + project income + General Fund allocations.'] };
  }

  private async r_departments(sc: any, r: any, _q: any, rep: Report) {
    const depts = await this.prisma.department.findMany({ where: { fellowship_id: sc.fellowshipId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    const rows: any[] = [];
    for (const d of depts) {
      const s = await this.summaryFor(sc.fellowshipId, d.id, r);
      rows.push({ department: d.name, contributions: s.contributionsCollected, fees: s.membershipFeesCollected, outstandingFees: s.outstandingMembershipFees, expenses: s.totalExpenditure, balance: s.availableBalance, budget: s.approvedBudget });
    }
    return { ...rep, columns: [col('department', 'Department'), col('contributions', 'Contributions', true), col('fees', 'Fees collected', true), col('outstandingFees', 'Fees outstanding', true), col('expenses', 'Spent', true), col('balance', 'Balance', true), col('budget', 'Approved budget', true)], rows };
  }

  private async r_funding_sources(sc: any, r: any, _q: any, rep: Report) {
    const income = await this.prisma.incomeRecord.groupBy({ by: ['funding_source'], where: { fellowship_id: sc.fellowshipId, status: 'active', account: { department_id: sc.departmentId }, ...(r ? { date: r } : {}) }, _sum: { amount: true }, _count: { _all: true } });
    const contribs = await this.prisma.contribution.groupBy({ by: ['contributor_type'], where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, status: 'active', ...(r ? { date: r } : {}) }, _sum: { amount: true }, _count: { _all: true } });
    const rows = [
      ...contribs.map((c) => ({ source: `Contributions (${c.contributor_type})`, count: c._count._all, amount: money(c._sum.amount) })),
      ...income.map((i) => ({ source: i.funding_source ?? 'Other income', count: i._count._all, amount: money(i._sum.amount) })),
    ];
    const total = rows.reduce((s, x) => s.plus(x.amount), ZERO);
    return { ...rep, columns: [col('source', 'Source'), col('count', 'Records'), col('amount', 'Amount', true)], rows, totals: { amount: total.toFixed(2) } };
  }

  private async r_transfers(sc: any, r: any, _q: any, rep: Report) {
    const where: any = { fellowship_id: sc.fellowshipId, ...(r ? { transfer_date: r } : {}) };
    if (sc.departmentId) where.OR = [{ fromAccount: { department_id: sc.departmentId } }, { toAccount: { department_id: sc.departmentId } }];
    const rows = await this.prisma.financialTransfer.findMany({ where, orderBy: { transfer_date: 'asc' }, take: MAX_ROWS + 1, include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } });
    return { ...rep, columns: [col('number', 'Transfer'), col('date', 'Date'), col('from', 'From'), col('to', 'To'), col('status', 'Status'), col('amount', 'Amount', true)],
      rows: rows.map((t) => ({ number: t.transfer_number, date: t.transfer_date, from: t.fromAccount.name, to: t.toAccount.name, status: t.status, amount: money(t.amount) })),
      notes: ['Transfers move money between accounts; they are never counted as income or expenditure.'] };
  }

  private async r_audit(sc: any, r: any, _q: any, rep: Report) {
    const rows = await this.prisma.auditLog.findMany({
      where: { fellowship_id: sc.fellowshipId, OR: [{ action: { startsWith: 'finance.' } }, { action: { startsWith: 'project.' } }], NOT: { action: 'finance.report_generated' }, ...(r ? { timestamp: r } : {}) },
      orderBy: { timestamp: 'asc' }, take: MAX_ROWS + 1,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((x) => x.user_id).filter((x): x is string => !!x))) } }, select: { id: true, first_name: true, last_name: true } });
    const name = new Map(users.map((u) => [u.id, `${u.first_name} ${u.last_name}`]));
    return { ...rep, columns: [col('when', 'When'), col('who', 'Who'), col('action', 'Action'), col('entity', 'Record'), col('comment', 'Reason / comment')],
      rows: rows.map((x) => ({ when: x.timestamp.toISOString().replace('T', ' ').slice(0, 16), who: x.user_id ? name.get(x.user_id) ?? x.user_id : 'system', action: x.action, entity: `${x.entity_type ?? ''} ${x.entity_id ? x.entity_id.slice(0, 8) : ''}`.trim(), comment: x.comment })) };
  }

  // ===================== dashboard =====================

  async dashboard(user: any, q: any) {
    const sc = await this.reportScope(user, q);
    const year = new Date().getUTCFullYear();
    const since = new Date(Date.UTC(year, new Date().getUTCMonth() - 11, 1));
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const deptSql = sc.departmentId ? Prisma.sql`AND "department_id" = ${sc.departmentId}::uuid` : Prisma.sql`AND "department_id" IS NULL`;
    const monthly = await this.prisma.$queryRaw<{ month: Date; source_type: string; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', "entry_date") AS month, "source_type", SUM("amount") AS total
      FROM "ledger_entries" WHERE "fellowship_id" = ${sc.fellowshipId}::uuid ${deptSql} AND "entry_date" >= ${since}
      GROUP BY 1, 2 ORDER BY 1`;
    const months: Record<string, { month: string; income: Prisma.Decimal; expenses: Prisma.Decimal }> = {};
    for (let k = 0; k < 12; k++) {
      const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + k, 1));
      const key = d.toISOString().slice(0, 7);
      months[key] = { month: key, income: ZERO, expenses: ZERO };
    }
    let incomeYear = ZERO, expensesYear = ZERO;
    for (const m of monthly) {
      const key = new Date(m.month).toISOString().slice(0, 7);
      if (!months[key]) continue;
      if (SOURCE_INCOME.includes(m.source_type)) months[key].income = months[key].income.plus(m.total);
      if (SOURCE_EXPENSE.includes(m.source_type)) months[key].expenses = months[key].expenses.plus(D(m.total).negated());
      if (new Date(m.month) >= yearStart) {
        if (SOURCE_INCOME.includes(m.source_type)) incomeYear = incomeYear.plus(m.total);
        if (SOURCE_EXPENSE.includes(m.source_type)) expensesYear = expensesYear.plus(D(m.total).negated());
      }
    }
    const [balance, budgets, recent, inbox] = await Promise.all([
      this.prisma.financialAccount.aggregate({ where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, is_active: true }, _sum: { balance: true } }),
      this.prisma.budget.findMany({ where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId, approval_status: 'FINAL_APPROVED', fiscal_year: { startsWith: String(year) } }, select: { id: true, amount: true } }),
      this.prisma.ledgerEntry.findMany({ where: { fellowship_id: sc.fellowshipId, department_id: sc.departmentId }, orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }], take: 10, include: { account: { select: { name: true } } } }),
      this.approvals.inbox(user),
    ]);
    let budgetTotal = ZERO, budgetUsed = ZERO;
    for (const b of budgets) {
      const perf = await budgetPerformance(this.prisma, b.id);
      budgetTotal = budgetTotal.plus(b.amount);
      budgetUsed = budgetUsed.plus(perf.totals.spent);
    }
    const out: any = {
      scope: sc.departmentId ? 'department' : 'central', departmentId: sc.departmentId, label: sc.label,
      cards: {
        totalIncome: incomeYear.toFixed(2), totalExpenses: expensesYear.toFixed(2), availableBalance: money(balance._sum.balance),
        pendingApprovals: inbox.length,
        budgetApproved: budgetTotal.toFixed(2), budgetSpent: budgetUsed.toFixed(2),
        budgetUtilisationPercent: budgetTotal.isZero() ? null : Math.round(budgetUsed.div(budgetTotal).times(100).toNumber()),
      },
      monthly: Object.values(months).map((m) => ({ month: m.month, income: m.income.toFixed(2), expenses: m.expenses.toFixed(2) })),
      recent: recent.map((e) => ({ id: e.id, date: e.entry_date, type: e.entry_type, description: e.description, reference: e.reference, account: e.account.name, amount: money(e.amount) })),
    };
    if (!sc.departmentId) out.generalFund = await generalFundPosition(this.prisma, sc.fellowshipId);
    else out.department = await this.summaryFor(sc.fellowshipId, sc.departmentId, undefined);
    return out;
  }

  // ===================== department transparency summary (aggregates only) =====================

  async summaryFor(fellowshipId: string, departmentId: string, r: any) {
    const dated = r ? { date: r } : {};
    const [contrib, fees, paid, balance, budgets] = await Promise.all([
      this.prisma.contribution.aggregate({ where: { fellowship_id: fellowshipId, department_id: departmentId, status: 'active', membership_fee_id: null, ...dated }, _sum: { amount: true } }),
      this.prisma.contribution.aggregate({ where: { fellowship_id: fellowshipId, department_id: departmentId, status: 'active', membership_fee_id: { not: null }, ...dated }, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { fellowship_id: fellowshipId, payment_status: 'paid', reversed_at: null, account: { department_id: departmentId }, ...(r ? { paid_at: r } : {}) }, _sum: { amount_paid: true } }),
      this.prisma.financialAccount.aggregate({ where: { fellowship_id: fellowshipId, department_id: departmentId }, _sum: { balance: true } }),
      this.prisma.budget.findMany({ where: { fellowship_id: fellowshipId, department_id: departmentId, approval_status: 'FINAL_APPROVED' }, orderBy: { created_at: 'desc' }, take: 5 }),
    ]);
    let outstandingFees = ZERO;
    const activeFees = await this.prisma.membershipFee.findMany({ where: { department_id: departmentId, is_active: true } });
    for (const f of activeFees) {
      const dues = feeDueDates(f, new Date()).length;
      const eligible = f.eligible_member_ids as string[] | null;
      const members = await this.prisma.departmentMember.findMany({ where: { department_id: departmentId, removed: false, ...(eligible ? { member_id: { in: eligible } } : {}) }, select: { member_id: true } });
      const byMember = await this.prisma.contribution.groupBy({ by: ['member_id'], where: { membership_fee_id: f.id, status: 'active' }, _sum: { amount: true } });
      const paidMap = new Map(byMember.map((b) => [b.member_id, D(b._sum.amount)]));
      for (const m of members) outstandingFees = outstandingFees.plus(Prisma.Decimal.max(D(f.amount).times(dues).minus(paidMap.get(m.member_id) ?? ZERO), ZERO));
    }
    const budgetRows: any[] = [];
    let approved = ZERO;
    for (const b of budgets) {
      const perf = await budgetPerformance(this.prisma, b.id);
      approved = approved.plus(b.amount);
      budgetRows.push({ title: b.title, fiscalYear: b.fiscal_year, approved: money(b.amount), spent: perf.totals.spent });
    }
    return {
      contributionsCollected: money(contrib._sum.amount),
      membershipFeesCollected: money(fees._sum.amount),
      outstandingMembershipFees: outstandingFees.toFixed(2),
      totalExpenditure: money(paid._sum.amount_paid),
      availableBalance: money(balance._sum.balance),
      approvedBudget: approved.toFixed(2),
      budgets: budgetRows,
    };
  }

  /** What a department may share with its members: totals only - no names, phones or individual payments. */
  async departmentSummary(user: any, departmentId: string, q: any): Promise<Report> {
    await this.scope.requireView(user, departmentId);
    const fellowshipId = this.scope.fellowship(user);
    const dept = await this.scope.department(user, departmentId);
    const r = range(q);
    const s = await this.summaryFor(fellowshipId, departmentId, r);
    const settings = await getSettings(this.prisma as any, fellowshipId);
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.department_summary', entity_type: 'department', entity_id: departmentId, fellowship_id: fellowshipId } });
    return {
      key: 'department-summary', title: `${dept.name}: financial summary`,
      subtitle: r ? `${r.gte?.toISOString().slice(0, 10) ?? 'start'} to ${r.lte?.toISOString().slice(0, 10) ?? 'today'}` : 'All records to date',
      generatedAt: new Date(), currency: settings.currency,
      summary: [
        { label: 'Contributions collected', value: s.contributionsCollected },
        { label: 'Membership fees collected', value: s.membershipFeesCollected },
        { label: 'Membership fees outstanding', value: s.outstandingMembershipFees },
        { label: 'Total expenditure', value: s.totalExpenditure },
        { label: 'Available balance', value: s.availableBalance },
      ],
      columns: [col('title', 'Budget'), col('fiscalYear', 'Year'), col('approved', 'Approved', true), col('spent', 'Spent', true)],
      rows: s.budgets,
      notes: ['This summary shows totals only. It contains no names, phone numbers or individual payments.'],
    };
  }
}
