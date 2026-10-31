import { Prisma } from '@prisma/client';
import { D, Tx, ZERO } from './ledger';

/**
 * A budget line's position: approved amount, money actually paid against it, approved-but-unpaid commitments, and
 * what remains. Pending (not yet approved) spending is not a commitment.
 */
export async function lineUsage(tx: Tx | any, lineId: string, excludeExpenseId?: string) {
  const line = await tx.budgetLineItem.findUnique({ where: { id: lineId } });
  if (!line) return null;
  const notSelf = excludeExpenseId ? { id: { not: excludeExpenseId } } : {};
  const [paid, unpaid, requests] = await Promise.all([
    tx.expense.aggregate({ where: { budget_line_id: lineId, payment_status: 'paid', reversed_at: null, ...notSelf }, _sum: { amount_paid: true } }),
    tx.expense.findMany({ where: { budget_line_id: lineId, approval_status: 'FINAL_APPROVED', payment_status: 'unpaid', reversed_at: null, money_request_id: null, ...notSelf }, select: { amount: true, amount_approved: true } }),
    tx.moneyRequest.aggregate({ where: { budget_line_id: lineId, approval_status: 'FINAL_APPROVED', release: null }, _sum: { amount: true } }),
  ]);
  const spent = D(paid._sum.amount_paid);
  const committed = unpaid.reduce((s: Prisma.Decimal, e: any) => s.plus(e.amount_approved ?? e.amount), ZERO).plus(D(requests._sum.amount));
  const approved = D(line.amount);
  return { line, approved, spent, committed, remaining: approved.minus(spent).minus(committed) };
}

/** Whole-budget position, line by line. */
export async function budgetPerformance(tx: Tx | any, budgetId: string, warningPercent = 80) {
  const lines = await tx.budgetLineItem.findMany({ where: { budget_id: budgetId }, orderBy: { sort_order: 'asc' } });
  const out: any[] = [];
  let approved = ZERO, spent = ZERO, committed = ZERO;
  for (const l of lines) {
    const u = await lineUsage(tx, l.id);
    if (!u) continue;
    if (l.is_active) { approved = approved.plus(u.approved); }
    spent = spent.plus(u.spent);
    committed = committed.plus(u.committed);
    const used = u.approved.isZero() ? (u.spent.plus(u.committed).greaterThan(0) ? 100 : 0) : u.spent.plus(u.committed).div(u.approved).times(100).toNumber();
    out.push({
      id: l.id, name: l.name, categoryId: l.category_id, notes: l.notes, isActive: l.is_active,
      approved: u.approved.toFixed(2), spent: u.spent.toFixed(2), committed: u.committed.toFixed(2), remaining: u.remaining.toFixed(2),
      utilisationPercent: Math.round(used), warning: used >= warningPercent, overspent: u.remaining.isNegative(),
    });
  }
  // Spending linked to the budget but to no line (e.g. legacy budgets without lines).
  const [paidNoLine, unpaidNoLine] = await Promise.all([
    tx.expense.aggregate({ where: { budget_id: budgetId, budget_line_id: null, payment_status: 'paid', reversed_at: null }, _sum: { amount_paid: true } }),
    tx.expense.findMany({ where: { budget_id: budgetId, budget_line_id: null, approval_status: 'FINAL_APPROVED', payment_status: 'unpaid', reversed_at: null }, select: { amount: true, amount_approved: true } }),
  ]);
  spent = spent.plus(D(paidNoLine._sum.amount_paid));
  committed = committed.plus(unpaidNoLine.reduce((s: Prisma.Decimal, e: any) => s.plus(e.amount_approved ?? e.amount), ZERO));
  return { lines: out, totals: { spent: spent.toFixed(2), committed: committed.toFixed(2), lineTotal: approved.toFixed(2) } };
}
