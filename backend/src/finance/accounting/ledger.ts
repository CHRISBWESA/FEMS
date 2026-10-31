import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The ledger: the financial source of truth.
 *
 * Every movement of real money is one immutable `ledger_entries` row against one account, and the account's balance
 * changes in the same statement that checks it. These are plain functions over a transaction client so that the
 * approval engine's final-approval hooks (which run inside the decision's transaction) can post to the ledger too.
 */

export type Tx = Prisma.TransactionClient;
export type EntryType = 'opening_balance' | 'contribution' | 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'reversal' | 'adjustment';

export const D = (v: Prisma.Decimal.Value | null | undefined): Prisma.Decimal => new Prisma.Decimal(v ?? 0);
export const money = (v: Prisma.Decimal.Value | null | undefined): string => D(v).toFixed(2);
export const ZERO = new Prisma.Decimal(0);

/** Next reference number for a fellowship, e.g. RCT-2026-00042. Atomic: two concurrent callers never share one. */
export async function nextNumber(tx: Tx, fellowshipId: string, key: string, prefix: string, at: Date = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "finance_counters" ("fellowship_id", "key", "year", "value")
    VALUES (${fellowshipId}::uuid, ${key}, ${year}, 1)
    ON CONFLICT ("fellowship_id", "key", "year") DO UPDATE SET "value" = "finance_counters"."value" + 1
    RETURNING "value"`;
  return `${prefix}-${year}-${String(Number(rows[0].value)).padStart(5, '0')}`;
}

export interface PostInput {
  fellowshipId: string;
  accountId: string;
  /** Signed: positive is money into the account, negative is money out. */
  amount: Prisma.Decimal.Value;
  entryType: EntryType;
  sourceType: string;
  sourceId: string;
  date: Date;
  userId: string;
  departmentId?: string | null;
  projectId?: string | null;
  reference?: string | null;
  description?: string | null;
  /** Primary postings are de-duplicated: one source can be posted once per entry type. */
  primary?: boolean;
  reversesEntryId?: string;
  /** Corrections (reversals, reconciliation adjustments) may take a balance below zero; ordinary payments may not. */
  allowOverdraw?: boolean;
}

/**
 * Posts one entry and moves the account balance with it. A payment that would overdraw the account fails, decided by
 * the same conditional UPDATE that changes the balance - so two payments racing for the last shilling cannot both win.
 */
export async function postEntry(tx: Tx, p: PostInput) {
  const amount = D(p.amount);
  if (amount.isZero()) throw new BadRequestException('A ledger entry cannot be zero.');
  const amt = amount.toFixed(2);
  const rows = amount.isNegative() && !p.allowOverdraw
    ? await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
        UPDATE "financial_accounts" SET "balance" = "balance" + ${amt}::numeric, "updated_at" = now()
        WHERE "id" = ${p.accountId}::uuid AND "fellowship_id" = ${p.fellowshipId}::uuid AND "is_active" = true
          AND "balance" + ${amt}::numeric >= 0
        RETURNING "balance"`
    : await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
        UPDATE "financial_accounts" SET "balance" = "balance" + ${amt}::numeric, "updated_at" = now()
        WHERE "id" = ${p.accountId}::uuid AND "fellowship_id" = ${p.fellowshipId}::uuid AND "is_active" = true
        RETURNING "balance"`;
  if (rows.length !== 1) {
    const account = await tx.financialAccount.findFirst({ where: { id: p.accountId, fellowship_id: p.fellowshipId }, select: { name: true, is_active: true, balance: true } });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.is_active) throw new BadRequestException(`The account "${account.name}" is inactive.`);
    throw new ConflictException(`Insufficient funds: "${account.name}" holds ${money(account.balance)}, which is less than ${money(amount.abs())}.`);
  }
  try {
    return await tx.ledgerEntry.create({
      data: {
        fellowship_id: p.fellowshipId,
        account_id: p.accountId,
        department_id: p.departmentId ?? null,
        project_id: p.projectId ?? null,
        entry_type: p.entryType,
        amount: amt,
        balance_after: rows[0].balance,
        entry_date: p.date,
        source_type: p.sourceType,
        source_id: p.sourceId,
        reference: p.reference ?? null,
        description: p.description ?? null,
        dedupe_key: p.primary ? `${p.sourceType}:${p.sourceId}:${p.entryType}` : null,
        reverses_entry_id: p.reversesEntryId ?? null,
        created_by: p.userId,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new ConflictException('This transaction has already been recorded.');
    throw err;
  }
}

/**
 * Cancels every entry a source posted (that is not already reversed) with an equal and opposite entry. The original
 * entries stay; `reverses_entry_id` is unique, so an entry can never be reversed twice.
 */
export async function reverseSource(tx: Tx, fellowshipId: string, sourceType: string, sourceId: string, userId: string, reason: string): Promise<number> {
  const entries = await tx.ledgerEntry.findMany({
    where: { fellowship_id: fellowshipId, source_type: sourceType, source_id: sourceId, entry_type: { not: 'reversal' } },
    orderBy: { created_at: 'asc' },
  });
  let n = 0;
  for (const e of entries) {
    const already = await tx.ledgerEntry.findUnique({ where: { reverses_entry_id: e.id }, select: { id: true } });
    if (already) continue;
    await postEntry(tx, {
      fellowshipId, accountId: e.account_id, amount: D(e.amount).negated(), entryType: 'reversal',
      sourceType, sourceId, date: new Date(), userId, departmentId: e.department_id, projectId: e.project_id,
      reference: e.reference, description: `Reversal: ${reason}`, reversesEntryId: e.id, allowOverdraw: true,
    });
    n++;
  }
  return n;
}

/** The account must exist in this fellowship, be active, and belong to the given scope (null = central funds). */
export async function assertAccountScope(tx: Tx, accountId: string, fellowshipId: string, departmentId: string | null) {
  const account = await tx.financialAccount.findFirst({ where: { id: accountId, fellowship_id: fellowshipId } });
  if (!account || (account.department_id ?? null) !== (departmentId ?? null)) {
    throw new BadRequestException(departmentId ? 'Choose one of this department\'s own accounts.' : 'Choose one of the fellowship\'s central accounts.');
  }
  if (!account.is_active) throw new BadRequestException(`The account "${account.name}" is inactive.`);
  return account;
}

/** The scope's default account ("Cash in hand"), created on first use. */
export async function defaultAccount(tx: Tx, fellowshipId: string, departmentId: string | null, userId: string) {
  const key = `${fellowshipId}:${departmentId ?? 'central'}`;
  const existing = await tx.financialAccount.findUnique({ where: { default_key: key } });
  if (existing) {
    if (!existing.is_active) throw new BadRequestException('The default account is inactive; choose an account.');
    return existing;
  }
  const settings = await tx.financeSettings.findUnique({ where: { fellowship_id: fellowshipId }, select: { currency: true } });
  return tx.financialAccount.upsert({
    where: { default_key: key },
    update: {},
    create: {
      fellowship_id: fellowshipId, department_id: departmentId, name: 'Cash in hand', account_type: 'cash',
      currency: settings?.currency ?? 'TZS', is_default: true, default_key: key, created_by: userId,
      description: 'Created automatically as the default account.',
    },
  });
}

export async function getSettings(tx: Tx, fellowshipId: string) {
  const s = await tx.financeSettings.findUnique({ where: { fellowship_id: fellowshipId } });
  return s ?? {
    currency: 'TZS', receipt_prefix: 'RCT', major_expense_threshold: null, budget_warning_percent: 80,
    financial_year_start_month: 1, payment_methods: ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'],
  };
}
