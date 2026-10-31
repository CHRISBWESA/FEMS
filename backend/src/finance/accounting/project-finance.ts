import { Prisma } from '@prisma/client';
import { D, Tx, ZERO } from './ledger';

/**
 * A project's money, computed from the records themselves (never stored, so it can never drift):
 *  - funding received = contribution allocations + project income + approved General Fund allocations (net of returns);
 *  - paid = expenses actually paid for the project;
 *  - committed = approved but unpaid expenses and approved money requests not yet paid out;
 *  - pledges are promises and are reported separately - they are never counted as money received.
 */
export interface ProjectFinancials {
  budget: string;
  contributions: string;
  income: string;
  generalFundAllocations: string;
  fundingReceived: string;
  expensesPaid: string;
  commitments: string;
  pledgesOutstanding: string;
  pledgedTotal: string;
  remainingBudget: string;
  unspentFunds: string;
  fundingProgressPercent: number;
}

export async function projectFinancials(tx: Tx | any, project: { id: string; budget_amount: Prisma.Decimal.Value }): Promise<ProjectFinancials> {
  const pid = project.id;
  const [alloc, income, fund, paid, unpaidExp, openRequests, pledges] = await Promise.all([
    tx.contributionAllocation.aggregate({ where: { project_id: pid, is_active: true, contribution: { status: 'active' } }, _sum: { amount: true } }),
    tx.incomeRecord.aggregate({ where: { project_id: pid, status: 'active' }, _sum: { amount: true } }),
    tx.projectAllocation.aggregate({ where: { project_id: pid, status: 'APPROVED' }, _sum: { amount: true } }),
    tx.expense.aggregate({ where: { project_id: pid, payment_status: 'paid', reversed_at: null }, _sum: { amount_paid: true } }),
    tx.expense.findMany({ where: { project_id: pid, approval_status: 'FINAL_APPROVED', payment_status: 'unpaid', reversed_at: null, money_request_id: null }, select: { amount: true, amount_approved: true } }),
    tx.moneyRequest.aggregate({ where: { project_id: pid, approval_status: 'FINAL_APPROVED', release: null }, _sum: { amount: true } }),
    tx.contributionPledge.findMany({ where: { project_id: pid, status: { in: ['pending', 'partially_fulfilled', 'fulfilled'] } }, select: { amount: true, amount_fulfilled: true, status: true } }),
  ]);
  const contributions = D(alloc._sum.amount);
  const inc = D(income._sum.amount);
  const gf = D(fund._sum.amount);
  const funding = contributions.plus(inc).plus(gf);
  const spent = D(paid._sum.amount_paid);
  const committed = unpaidExp.reduce((a: Prisma.Decimal, e: any) => a.plus(e.amount_approved ?? e.amount), ZERO).plus(D(openRequests._sum.amount));
  const pledgedTotal = pledges.reduce((a: Prisma.Decimal, p: any) => a.plus(p.amount), ZERO);
  const outstanding = pledges
    .filter((p: any) => p.status !== 'fulfilled')
    .reduce((a: Prisma.Decimal, p: any) => a.plus(Prisma.Decimal.max(D(p.amount).minus(p.amount_fulfilled), ZERO)), ZERO);
  const budget = D(project.budget_amount);
  return {
    budget: budget.toFixed(2),
    contributions: contributions.toFixed(2),
    income: inc.toFixed(2),
    generalFundAllocations: gf.toFixed(2),
    fundingReceived: funding.toFixed(2),
    expensesPaid: spent.toFixed(2),
    commitments: committed.toFixed(2),
    pledgesOutstanding: outstanding.toFixed(2),
    pledgedTotal: pledgedTotal.toFixed(2),
    remainingBudget: budget.minus(spent).minus(committed).toFixed(2),
    unspentFunds: funding.minus(spent).toFixed(2),
    fundingProgressPercent: budget.isZero() ? 0 : Math.min(999, Math.round(funding.div(budget).times(100).toNumber())),
  };
}

/**
 * The General Fellowship Fund: the central accounts' money that is not earmarked for a fellowship-wide project.
 * Moving money from the General Fund to a project is an internal allocation, never new income.
 */
export async function generalFundPosition(tx: Tx | any, fellowshipId: string) {
  const [central, projects] = await Promise.all([
    tx.financialAccount.aggregate({ where: { fellowship_id: fellowshipId, department_id: null }, _sum: { balance: true } }),
    tx.project.findMany({ where: { fellowship_id: fellowshipId, scope: 'fellowship' }, select: { id: true, budget_amount: true } }),
  ]);
  let earmarked = ZERO;
  for (const p of projects) {
    const f = await projectFinancials(tx, p);
    const unspent = D(f.unspentFunds);
    if (unspent.greaterThan(0)) earmarked = earmarked.plus(unspent);
  }
  const balance = D(central._sum.balance);
  return { centralBalance: balance.toFixed(2), earmarkedForProjects: earmarked.toFixed(2), available: balance.minus(earmarked).toFixed(2) };
}
