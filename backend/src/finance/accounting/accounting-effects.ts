import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, nextNumber, postEntry, Tx } from './ledger';
import { generalFundPosition, projectFinancials } from './project-finance';

async function audit(tx: Tx, userId: string | undefined, action: string, entityType: string, entityId: string, fellowshipId: string | null, newValue?: any) {
  await tx.auditLog.create({
    data: { user_id: userId, action, entity_type: entityType, entity_id: entityId, fellowship_id: fellowshipId, new_value: newValue as any },
  });
}

/**
 * What a FINAL approval does for the finance & projects workflows. Runs inside the decision's transaction (the
 * engine's final-approval hook): if anything here fails - e.g. the money is no longer there - the approval itself
 * rolls back, so "approved but not applied" can never be committed. Returns false for other workflow types.
 */
export async function applyAccountingEffect(tx: Tx, approval: any, actorUserId?: string): Promise<boolean> {
  const id = approval.entity_id;
  const actor = actorUserId ?? approval.created_by;
  switch (approval.workflow_type) {
    case 'fund_transfer': {
      const t = await tx.financialTransfer.findUnique({ where: { id }, include: { fromAccount: true, toAccount: true } });
      if (!t || t.approval_workflow_id !== approval.id) throw new BadRequestException('The transfer for this approval no longer exists.');
      const done = await tx.financialTransfer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'COMPLETED', completed_at: new Date() } });
      if (done.count !== 1) throw new ConflictException('This transfer is no longer pending.');
      await postTransferEntries(tx, t, actor);
      await audit(tx, actor, 'finance.transfer_completed', 'transfer', id, t.fellowship_id, { amount: D(t.amount).toFixed(2) });
      return true;
    }
    case 'project':
      // The status itself is set by syncAccountingStatus in the same transaction.
      await audit(tx, actor, 'project.approved', 'project', id, approval.fellowship_id);
      return true;
    case 'project_allocation': {
      const a = await tx.projectAllocation.findUnique({ where: { id } });
      if (!a || a.approval_workflow_id !== approval.id) throw new BadRequestException('The allocation for this approval no longer exists.');
      if (a.kind === 'general_fund_allocation') {
        const gf = await generalFundPosition(tx, a.fellowship_id);
        if (D(gf.available).lessThan(a.amount)) {
          throw new ConflictException(`The General Fund has ${gf.available} available, which is less than ${D(a.amount).toFixed(2)}.`);
        }
      }
      const done = await tx.projectAllocation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approved_at: new Date() } });
      if (done.count !== 1) throw new ConflictException('This allocation is no longer pending.');
      await audit(tx, actor, 'project.allocation_approved', 'project', a.project_id, a.fellowship_id, { amount: D(a.amount).toFixed(2) });
      return true;
    }
    case 'project_closure':
      await closeProject(tx, id, approval, actor);
      return true;
    case 'budget_revision':
      await applyBudgetRevision(tx, id, approval, actor);
      return true;
    case 'period_close': {
      const done = await tx.financialPeriod.updateMany({
        where: { id, closure_workflow_id: approval.id, is_closed: false },
        data: { is_closed: true, closed_by: actor, closed_at: new Date(), closure_status: 'approved' },
      });
      if (done.count !== 1) throw new ConflictException('This period is already closed.');
      await audit(tx, actor, 'finance.period_close', 'financial_period', id, approval.fellowship_id);
      return true;
    }
    default:
      return false;
  }
}

/** A transfer posts two entries: money out of the source, the same money into the destination. Never income or expense. */
export async function postTransferEntries(tx: Tx, t: any, actor: string) {
  const common = { fellowshipId: t.fellowship_id, sourceType: 'transfer', sourceId: t.id, date: t.transfer_date, userId: actor, reference: t.transfer_number, primary: true };
  await postEntry(tx, { ...common, accountId: t.from_account_id, amount: D(t.amount).negated(), entryType: 'transfer_out', departmentId: t.fromAccount?.department_id ?? null, description: t.description ?? 'Transfer out' });
  await postEntry(tx, { ...common, accountId: t.to_account_id, amount: D(t.amount), entryType: 'transfer_in', departmentId: t.toAccount?.department_id ?? null, description: t.description ?? 'Transfer in' });
}

async function closeProject(tx: Tx, projectId: string, approval: any, actor: string) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.closure_workflow_id !== approval.id) throw new BadRequestException('The project for this closure no longer exists.');
  if (project.status === 'CLOSED') throw new ConflictException('This project is already closed.');
  const f = await projectFinancials(tx, project);
  if (D(f.commitments).greaterThan(0)) {
    throw new ConflictException('The project still has approved payments that have not been made. Resolve them before closing.');
  }
  const unspent = D(f.unspentFunds);
  if (unspent.greaterThan(0)) {
    const base = { fellowship_id: project.fellowship_id, status: 'APPROVED', approved_at: new Date(), created_by: actor };
    if (project.unspent_disposition === 'carry_forward') {
      const target = project.carry_forward_project_id
        ? await tx.project.findFirst({ where: { id: project.carry_forward_project_id, fellowship_id: project.fellowship_id, scope: project.scope, department_id: project.department_id, status: { in: ['APPROVED', 'ACTIVE'] } } })
        : null;
      if (!target) throw new ConflictException('The project the unspent money should carry forward to is not open.');
      await tx.projectAllocation.create({ data: { ...base, allocation_number: await nextNumber(tx, project.fellowship_id, 'allocation', 'ALC'), project_id: project.id, kind: 'carry_forward_out', amount: unspent.negated(), related_project_id: target.id, notes: `Unspent funds carried forward to ${target.project_number}` } });
      await tx.projectAllocation.create({ data: { ...base, allocation_number: await nextNumber(tx, project.fellowship_id, 'allocation', 'ALC'), project_id: target.id, kind: 'carry_forward_in', amount: unspent, related_project_id: project.id, notes: `Carried forward from ${project.project_number}` } });
    } else {
      // The money stays in the same accounts; ending the earmark returns it to the General Fund (or, for a
      // department project, to the department's general funds).
      await tx.projectAllocation.create({ data: { ...base, allocation_number: await nextNumber(tx, project.fellowship_id, 'allocation', 'ALC'), project_id: project.id, kind: 'return_to_general_fund', amount: unspent.negated(), notes: 'Unspent funds returned at closure' } });
    }
  }
  await tx.project.update({ where: { id: project.id }, data: { status: 'CLOSED', closure_status: 'approved', closed_at: new Date() } });
  await audit(tx, actor, 'project.closed', 'project', project.id, project.fellowship_id, { unspent: unspent.toFixed(2), disposition: project.unspent_disposition });
}

interface ProposedLine { id?: string; name: string; categoryId?: string | null; amount: string; notes?: string | null }

async function applyBudgetRevision(tx: Tx, revisionId: string, approval: any, actor: string) {
  const revision = await tx.budgetRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.approval_workflow_id !== approval.id) throw new BadRequestException('The revision for this approval no longer exists.');
  const budget = await tx.budget.findUnique({ where: { id: revision.budget_id }, include: { lines: { where: { is_active: true }, orderBy: { sort_order: 'asc' } } } });
  if (!budget) throw new BadRequestException('The budget for this revision no longer exists.');
  if (budget.version !== revision.from_version) {
    throw new ConflictException('The budget changed after this revision was proposed. Propose the revision again.');
  }
  const previousLines = budget.lines.map((l) => ({ id: l.id, name: l.name, categoryId: l.category_id, amount: D(l.amount).toFixed(2), notes: l.notes }));
  const proposed = (revision.proposed_lines as unknown as ProposedLine[]) || [];
  const keep = new Set<string>();
  let order = 0;
  for (const line of proposed) {
    const data = { name: line.name, category_id: line.categoryId ?? null, amount: line.amount, notes: line.notes ?? null, sort_order: order++, is_active: true };
    if (line.id && budget.lines.some((l) => l.id === line.id)) {
      await tx.budgetLineItem.update({ where: { id: line.id }, data });
      keep.add(line.id);
    } else {
      const created = await tx.budgetLineItem.create({ data: { ...data, budget_id: budget.id } });
      keep.add(created.id);
    }
  }
  // Lines dropped by the revision stay on record (expenses may point at them) but leave the budget.
  await tx.budgetLineItem.updateMany({ where: { budget_id: budget.id, is_active: true, id: { notIn: Array.from(keep) } }, data: { is_active: false } });
  await tx.budget.update({ where: { id: budget.id }, data: { amount: revision.proposed_amount, version: budget.version + 1 } });
  await tx.budgetRevision.update({
    where: { id: revision.id },
    data: { status: 'FINAL_APPROVED', applied_at: new Date(), previous_lines: previousLines as unknown as Prisma.InputJsonValue, previous_amount: budget.amount },
  });
  await audit(tx, actor, 'finance.budget_revision_applied', 'budget', budget.id, budget.fellowship_id, { fromVersion: budget.version, toVersion: budget.version + 1, amount: D(revision.proposed_amount).toFixed(2) });
}
