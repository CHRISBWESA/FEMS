import { Prisma } from '@prisma/client';

/**
 * Workflows whose entity is one of the finance & projects records. The approval engine calls `syncAccountingStatus`
 * inside every decision's transaction so the record's own status always matches its approval. The money-moving part
 * of a FINAL approval lives in accounting-effects.ts (it runs in the same transaction, as the final-approval hook).
 */
export const ACCOUNTING_WORKFLOWS = ['project', 'project_closure', 'project_allocation', 'fund_transfer', 'budget_revision', 'period_close'];

const pending = (s: string) => ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(s);

export async function syncAccountingStatus(tx: Prisma.TransactionClient, approval: any, status: string): Promise<void> {
  const id = approval.entity_id;
  switch (approval.workflow_type) {
    case 'project': {
      const next = pending(status) ? 'PENDING_APPROVAL'
        : status === 'FINAL_APPROVED' ? 'APPROVED'
        : status === 'RETURNED' ? 'RETURNED'
        : status === 'REJECTED' ? 'REJECTED'
        : status === 'CANCELLED' ? 'DRAFT' : null;
      if (!next) return;
      await tx.project.updateMany({
        where: { id, approval_workflow_id: approval.id },
        data: { status: next as any, ...(next === 'APPROVED' ? { approved_at: new Date() } : {}) },
      });
      return;
    }
    case 'project_closure': {
      if (status === 'FINAL_APPROVED') return; // the closure effect closes the project
      const next = pending(status) ? 'pending' : status === 'RETURNED' ? 'returned' : status === 'REJECTED' ? 'rejected' : status === 'CANCELLED' ? null : null;
      await tx.project.updateMany({ where: { id, closure_workflow_id: approval.id }, data: { closure_status: next } });
      return;
    }
    case 'project_allocation':
    case 'fund_transfer': {
      if (status === 'FINAL_APPROVED') return; // the effect completes it (after re-checking the money is there)
      const next = pending(status) ? 'PENDING' : status;
      const where = { id, approval_workflow_id: approval.id };
      if (approval.workflow_type === 'project_allocation') await tx.projectAllocation.updateMany({ where, data: { status: next } });
      else await tx.financialTransfer.updateMany({ where, data: { status: next } });
      return;
    }
    case 'budget_revision': {
      if (status === 'FINAL_APPROVED') return; // the effect applies the revision
      await tx.budgetRevision.updateMany({
        where: { id, approval_workflow_id: approval.id },
        data: { status: (status === 'APPROVED' ? 'UNDER_REVIEW' : status) as any },
      });
      return;
    }
    case 'period_close': {
      if (status === 'FINAL_APPROVED') return;
      const next = pending(status) ? 'pending' : status === 'RETURNED' ? 'returned' : status === 'REJECTED' ? 'rejected' : null;
      await tx.financialPeriod.updateMany({ where: { id, closure_workflow_id: approval.id }, data: { closure_status: next } });
      return;
    }
  }
}
