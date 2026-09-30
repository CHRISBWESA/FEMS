import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
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

  if (effect.action === 'delete') {
    // Recoverable: the row is copied to the recycle bin (30-day restore window) before deletion.
    await tx.deletedRecord.create({
      data: {
        original_collection: cfg.collection,
        original_record_id: record.id,
        original_data: JSON.parse(JSON.stringify(record)),
        fellowship_id: record.fellowship_id ?? null,
        deleted_by: actorUserId ?? approval.created_by,
        restore_token: randomBytes(24).toString('hex'),
      },
    });
    await db[cfg.model].delete({ where: { id: record.id } });
    await audit(tx, actorUserId, `finance.${effect.kind}_delete_applied`, effect.kind, record.id, { amount: record.amount?.toString?.() });
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
