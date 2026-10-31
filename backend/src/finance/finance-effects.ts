import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, postEntry, reverseSource } from './accounting/ledger';
import { reverseContributionTx } from './accounting/contributions-core.service';
import { assertPeriodOpen, validateAmount, validateDate, validateOptionalUuid, validateText } from './finance.validation';

export type FinanceKind = 'contribution' | 'expense' | 'budget' | 'income';

interface KindConfig {
  model: 'contribution' | 'expense' | 'budget' | 'incomeRecord';
  collection: string;
  dateColumn?: string;
}

const KINDS: Record<FinanceKind, KindConfig> = {
  contribution: { model: 'contribution', collection: 'contributions', dateColumn: 'date' },
  expense: { model: 'expense', collection: 'expenses', dateColumn: 'date' },
  budget: { model: 'budget', collection: 'budgets' },
  income: { model: 'incomeRecord', collection: 'income_records', dateColumn: 'date' },
};

// workflow type -> what to do on FINAL approval
const WORKFLOW_EFFECTS: Record<string, { kind: FinanceKind; action: 'edit' | 'delete' }> = {
  contribution_edit: { kind: 'contribution', action: 'edit' },
  contribution_delete: { kind: 'contribution', action: 'delete' },
  expense_edit: { kind: 'expense', action: 'edit' },
  expense_delete: { kind: 'expense', action: 'delete' },
  budget_edit: { kind: 'budget', action: 'edit' },
  budget_delete: { kind: 'budget', action: 'delete' },
  income_edit: { kind: 'income', action: 'edit' },
  income_delete: { kind: 'income', action: 'delete' },
};

// The ONLY fields an edit request may change: API name -> [db column, parser]. Anything else in a
// request body is ignored, so an edit request can never touch ownership, status, tenant or approval columns.
const EDIT_SPECS: Record<FinanceKind, Record<string, [string, (v: unknown) => any]>> = {
  contribution: {
    amount: ['amount', (v) => validateAmount('amount', v)],
    contributionType: ['contribution_type', (v) => validateText('contributionType', v, 50, true)],
    date: ['date', (v) => validateDate('date', v)],
    notes: ['notes', (v) => validateText('notes', v, 500)],
    campaignId: ['campaign_id', (v) => validateOptionalUuid('campaignId', v)],
    categoryId: ['category_id', (v) => validateOptionalUuid('categoryId', v)],
  },
  expense: {
    title: ['title', (v) => validateText('title', v, 200, true)],
    description: ['description', (v) => validateText('description', v, 1000)],
    amount: ['amount', (v) => validateAmount('amount', v)],
    date: ['date', (v) => validateDate('date', v)],
    purpose: ['purpose', (v) => validateText('purpose', v, 300)],
    categoryId: ['category_id', (v) => validateOptionalUuid('categoryId', v)],
  },
  budget: {
    title: ['title', (v) => validateText('title', v, 200, true)],
    description: ['description', (v) => validateText('description', v, 1000)],
    amount: ['amount', (v) => validateAmount('amount', v)],
    fiscalYear: ['fiscal_year', (v) => validateFiscalYear(v)],
  },
  income: {
    title: ['title', (v) => validateText('title', v, 200, true)],
    description: ['description', (v) => validateText('description', v, 1000)],
    amount: ['amount', (v) => validateAmount('amount', v)],
    date: ['date', (v) => validateDate('date', v)],
    source: ['source', (v) => validateText('source', v, 200)],
    categoryId: ['category_id', (v) => validateOptionalUuid('categoryId', v)],
    campaignId: ['campaign_id', (v) => validateOptionalUuid('campaignId', v)],
  },
};

export function validateFiscalYear(value: unknown): string {
  const v = validateText('fiscalYear', value, 9, true) as string;
  if (!/^\d{4}(-\d{2,4})?$/.test(v)) {
    throw new BadRequestException('fiscalYear must look like 2026 or 2026-27');
  }
  return v;
}

// Validates an edit request body into snake_case column changes (JSON-safe, stored in the approval's
// metadata). Rejects an empty change set.
export function buildEditChanges(kind: FinanceKind, body: Record<string, unknown>): Record<string, any> {
  const changes: Record<string, any> = {};
  for (const [apiField, [column, parse]] of Object.entries(EDIT_SPECS[kind])) {
    if (body[apiField] !== undefined) {
      const parsed = parse(body[apiField]);
      changes[column] = parsed instanceof Date ? parsed.toISOString() : parsed;
    }
  }
  if (Object.keys(changes).length === 0) {
    throw new BadRequestException('No editable fields were provided');
  }
  return changes;
}

async function audit(tx: Prisma.TransactionClient, userId: string | undefined, action: string, entityType: string, entityId: string, oldValue?: any, newValue?: any) {
  await tx.auditLog.create({
    data: {
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldValue as any,
      new_value: newValue as any,
    },
  });
}

// Runs inside the final-approval transaction (see ApprovalEngineService.decide). Returns true if the
// workflow type is a finance edit/delete that was handled. Any failure throws, which rolls back the
// approval decision too - approved-but-not-applied can never be committed.
export async function applyFinanceEffect(
  tx: Prisma.TransactionClient,
  approval: any,
  actorUserId?: string,
): Promise<boolean> {
  const effect = WORKFLOW_EFFECTS[approval.workflow_type];
  if (!effect) return false;

  const cfg = KINDS[effect.kind];
  const db: any = tx;
  const record = await db[cfg.model].findUnique({ where: { id: approval.entity_id } });
  if (!record) {
    throw new BadRequestException('The record this request refers to no longer exists.');
  }
  if ((approval.fellowship_id ?? null) !== (record.fellowship_id ?? null)) {
    throw new BadRequestException('The record does not belong to this request\'s fellowship.');
  }

  if (cfg.dateColumn) {
    await assertPeriodOpen(tx as any, record.fellowship_id, record[cfg.dateColumn]);
  }

  const actor = actorUserId ?? approval.created_by;
  const reason: string = approval.metadata?.reason || 'Approved reversal request';

  if (effect.action === 'delete') {
    // Financial records are never deleted. An approved "delete" reverses the money in the ledger (or cancels a
    // record that never moved money) and keeps the row, so the history stays complete.
    if (effect.kind === 'contribution') {
      await reverseContributionTx(tx, record.id, actor, reason);
    } else if (effect.kind === 'income') {
      const done = await tx.incomeRecord.updateMany({ where: { id: record.id, status: 'active' }, data: { status: 'reversed', reversed_at: new Date(), reversed_by: actor, reversal_reason: reason } });
      if (done.count !== 1) throw new BadRequestException('This income has already been reversed.');
      if (record.fellowship_id) await reverseSource(tx, record.fellowship_id, 'income', record.id, actor, reason);
    } else if (effect.kind === 'expense') {
      if (record.reversed_at) throw new BadRequestException('This expense has already been reversed.');
      if (record.payment_status === 'paid' && record.fellowship_id) {
        await reverseSource(tx, record.fellowship_id, 'expense', record.id, actor, reason);
        await tx.expense.update({ where: { id: record.id }, data: { payment_status: 'reversed', reversed_at: new Date(), reversed_by: actor, reversal_reason: reason } });
      } else {
        await tx.expense.update({ where: { id: record.id }, data: { approval_status: 'CANCELLED', reversed_at: new Date(), reversed_by: actor, reversal_reason: reason } });
      }
    } else {
      await tx.budget.update({ where: { id: record.id }, data: { approval_status: 'CANCELLED' } });
    }
    await audit(tx, actorUserId, `finance.${effect.kind}_delete_applied`, effect.kind, record.id, { amount: record.amount?.toString?.() }, { outcome: effect.kind === 'budget' ? 'cancelled' : 'reversed', reason });
    return true;
  }

  const changes: Record<string, any> = { ...(approval.metadata?.changes || {}) };
  if (Object.keys(changes).length === 0) {
    throw new BadRequestException('This edit request carries no changes.');
  }
  if (changes.date) {
    changes.date = new Date(changes.date);
    await assertPeriodOpen(tx as any, record.fellowship_id, changes.date);
  }
  for (const [column, model] of [['category_id', 'financeCategory'], ['campaign_id', 'contributionCampaign']] as const) {
    if (changes[column]) {
      const ref = await db[model].findFirst({ where: { id: changes[column], fellowship_id: record.fellowship_id } });
      if (!ref) throw new BadRequestException(`The selected ${column === 'category_id' ? 'category' : 'campaign'} is not available.`);
    }
  }
  if (changes.amount !== undefined && !D(changes.amount).equals(record.amount)) {
    await adjustAmount(tx, effect.kind, record, D(changes.amount), actor, reason);
  }
  const updated = await db[cfg.model].update({ where: { id: record.id }, data: changes });
  await audit(
    tx,
    actorUserId,
    `finance.${effect.kind}_edit_applied`,
    effect.kind,
    record.id,
    { amount: record.amount?.toString?.() },
    { amount: updated.amount?.toString?.(), fields: Object.keys(changes) },
  );
  return true;
}

// An approved change of amount on money that is already in the ledger is posted as an adjustment for the
// difference; the original entry is never rewritten.
async function adjustAmount(tx: Prisma.TransactionClient, kind: FinanceKind, record: any, next: Prisma.Decimal, actor: string, reason: string) {
  if (record.status === 'reversed' || record.reversed_at) throw new BadRequestException('A reversed record cannot be edited.');
  if (kind === 'expense') {
    if (record.payment_status === 'paid') throw new BadRequestException('A paid expense cannot change its amount; reverse it and record it again.');
    return;
  }
  if (kind === 'budget') return;
  if (kind === 'contribution') {
    if (record.pledge_id || record.membership_fee_id) {
      throw new BadRequestException('A pledge or membership-fee payment cannot change its amount; reverse it and record it again.');
    }
    const allocated = await tx.contributionAllocation.aggregate({ where: { contribution_id: record.id, is_active: true }, _sum: { amount: true } });
    if (D(allocated._sum.amount).greaterThan(next)) throw new BadRequestException('The new amount is less than what is allocated to projects; change the allocations first.');
  }
  const sourceType = kind === 'contribution' ? 'contribution' : 'income';
  const posted = await tx.ledgerEntry.findFirst({ where: { source_type: sourceType, source_id: record.id, entry_type: { in: ['contribution', 'income'] } } });
  if (!posted) return;
  await postEntry(tx, {
    fellowshipId: record.fellowship_id, accountId: posted.account_id, amount: next.minus(record.amount), entryType: 'adjustment',
    sourceType, sourceId: record.id, date: new Date(), userId: actor, departmentId: posted.department_id,
    reference: posted.reference, description: `Amount corrected: ${reason}`, allowOverdraw: true,
  });
}
