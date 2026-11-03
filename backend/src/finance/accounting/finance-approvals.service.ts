import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { applyFinanceEffect } from '../finance-effects';
import { validateText } from '../finance.validation';
import { applyAccountingEffect } from './accounting-effects';
import { applyInventoryEffect, INVENTORY_WORKFLOWS } from '../../inventory/inventory-sync';
import { money } from './ledger';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

export const FINANCE_WORKFLOWS = [
  'expense', 'department_expense', 'department_expense_major',
  'project', 'project_closure', 'project_allocation',
  'contribution_edit', 'contribution_delete', 'expense_edit', 'expense_delete',
  ...INVENTORY_WORKFLOWS,
];

const LABEL: Record<string, string> = {
  money_request: 'Money request', expense: 'Expense', budget: 'Budget', department_expense: 'Department expense',
  department_expense_major: 'Department expense (central approval)', department_budget: 'Department budget',
  budget_revision: 'Budget revision', project: 'Project', project_closure: 'Project closure', project_allocation: 'General Fund allocation',
  fund_transfer: 'Fund transfer', period_close: 'Financial year closure', contribution_edit: 'Contribution correction',
  contribution_delete: 'Contribution reversal', income_edit: 'Income correction', income_delete: 'Income reversal',
  expense_edit: 'Expense correction', expense_delete: 'Expense reversal', budget_edit: 'Budget correction', budget_delete: 'Budget cancellation',
  asset_transfer_department: 'Resource ownership transfer', asset_transfer_fellowship: 'Resource ownership transfer',
  asset_disposal: 'Resource disposal / write-off', asset_disposal_department: 'Department resource disposal', asset_disposal_major: 'Department resource disposal (major)',
};

const ACTING: Record<string, string[]> = {
  secretary: ['secretary', 'assistant_secretary'],
  chairperson: ['chairperson', 'assistant_chairperson'],
};

/**
 * One inbox and one decision path for every finance and project approval. A person sees only the stages they may
 * decide: their own office (an assistant deputises), a department stage only for a department they lead, never their
 * own request, and never a second stage of a request they already approved.
 */
@Injectable()
export class FinanceApprovalsService {
  constructor(
    private prisma: PrismaService,
    private engine: ApprovalEngineService,
    private scope: FinanceScopeService,
    private notify: FinanceNotifyService,
  ) {}

  private eligible(user: any, step: any, approval: any, leads: Map<string, string>): boolean {
    if (approval.created_by === user.userId) return false;
    if (approval.steps.some((s: any) => s.status === 'approved' && s.acted_by === user.userId)) return false;
    const role = step.approver_role;
    if (role.startsWith('department_')) {
      const dept = (approval.metadata as any)?.departmentId;
      return !!dept && leads.get(dept) === role;
    }
    return this.scope.has(user, ...(ACTING[role] ?? [role]));
  }

  async inbox(user: any) {
    if (!user?.fellowshipId) return [];
    const leads = await this.scope.leaderships(user);
    const approvals = await this.prisma.approval.findMany({
      where: { fellowship_id: user.fellowshipId, workflow_type: { in: FINANCE_WORKFLOWS }, status: { in: ['SUBMITTED', 'RESUBMITTED', 'APPROVED'] } },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
      orderBy: { updated_at: 'asc' },
      take: 500,
    });
    const mine = approvals.filter((a) => {
      const step = a.steps.find((s) => s.stage_order === a.current_stage);
      return !!step && step.status === 'pending' && this.eligible(user, step, a, leads);
    });
    return Promise.all(mine.map((a) => this.summarise(a)));
  }

  /** Title, amount and number of the record behind an approval, for the inbox. */
  async summarise(a: any) {
    const id = a.entity_id;
    let s: any = null;
    switch (a.workflow_type) {
      case 'expense': case 'department_expense': case 'department_expense_major': case 'expense_edit': case 'expense_delete':
        s = await this.prisma.expense.findUnique({ where: { id }, select: { title: true, amount: true, expense_number: true, department_id: true } }); s = s && { title: s.title, amount: money(s.amount), number: s.expense_number, departmentId: s.department_id }; break;
      case 'project': case 'project_closure':
        s = await this.prisma.project.findUnique({ where: { id }, select: { name: true, budget_amount: true, project_number: true, department_id: true } }); s = s && { title: s.name, amount: money(s.budget_amount), number: s.project_number, departmentId: s.department_id, projectId: id }; break;
      case 'project_allocation': {
        const x = await this.prisma.projectAllocation.findUnique({ where: { id }, include: { project: { select: { name: true } } } });
        s = x && { title: `General Fund to ${x.project.name}`, amount: money(x.amount), number: x.allocation_number, projectId: x.project_id }; break;
      }
      case 'asset_transfer_department': case 'asset_transfer_fellowship': {
        const t = await this.prisma.assetTransfer.findUnique({ where: { id } });
        const a = t ? await this.prisma.asset.findUnique({ where: { id: t.asset_id }, select: { name: true, asset_tag: true } }) : null;
        s = t && { title: `${a?.name ?? 'Resource'} (${a?.asset_tag ?? ''}): ${t.from_ownership} to ${t.to_ownership}`, number: t.transfer_number, departmentId: t.from_department_id, assetId: t.asset_id, reason: t.reason }; break;
      }
      case 'asset_disposal': case 'asset_disposal_department': case 'asset_disposal_major': {
        const inc = await this.prisma.assetIncident.findUnique({ where: { id } });
        const a = inc ? await this.prisma.asset.findUnique({ where: { id: inc.asset_id }, select: { name: true, asset_tag: true, estimated_value: true, acquisition_cost: true } }) : null;
        s = inc && { title: `${a?.name ?? 'Resource'} (${a?.asset_tag ?? ''}): ${inc.proposed_action.replace('_', ' ')}`, number: inc.incident_number, departmentId: inc.department_id, assetId: inc.asset_id, reason: inc.description, amount: a?.estimated_value ?? a?.acquisition_cost ? money(a?.estimated_value ?? a?.acquisition_cost) : undefined }; break;
      }
      case 'contribution_edit': case 'contribution_delete': s = await this.prisma.contribution.findUnique({ where: { id }, select: { receipt_number: true, amount: true } }); s = s && { title: `Contribution ${s.receipt_number ?? ''}`, amount: money(s.amount), number: s.receipt_number }; break;
    }
    const step = a.steps.find((x: any) => x.stage_order === a.current_stage);
    return {
      approvalId: a.id, workflowType: a.workflow_type, label: LABEL[a.workflow_type] ?? a.workflow_type, entityId: id, entityType: a.entity_type,
      status: a.status, stage: a.current_stage, stageRole: step?.approver_role, stages: a.steps.length, submittedAt: a.created_at,
      reason: (a.metadata as any)?.reason ?? null, changes: (a.metadata as any)?.changes ?? null, ...(s ?? { title: '(record not found)' }),
    };
  }

  async decide(user: any, approvalId: string, body: any) {
    if (!isUuid(approvalId)) throw new NotFoundException('Approval not found');
    const decision = body?.decision;
    if (!['approved', 'returned', 'rejected'].includes(decision)) throw new BadRequestException("decision must be 'approved', 'returned' or 'rejected'");
    const comment = validateText('comment', body?.comment, 1000, decision !== 'approved') ?? '';
    const approval = await this.prisma.approval.findFirst({ where: { id: approvalId, fellowship_id: this.scope.fellowship(user) }, include: { steps: { orderBy: { stage_order: 'asc' } } } });
    if (!approval || !FINANCE_WORKFLOWS.includes(approval.workflow_type)) throw new NotFoundException('Approval not found');
    const step = approval.steps.find((s) => s.stage_order === approval.current_stage);
    if (!step || step.status !== 'pending') throw new BadRequestException('This request is not waiting for a decision.');
    if (approval.created_by === user.userId) throw new ForbiddenException('You cannot decide on a request that you submitted.');
    if (!this.eligible(user, step, approval, await this.scope.leaderships(user))) throw new ForbiddenException('You are not the approver for the current stage of this request.');

    const updated = await this.engine.decide(
      approvalId,
      { approverUserId: user.userId, approverRole: step.approver_role, decision, comment },
      async (tx, final) => {
        if (await applyFinanceEffect(tx, final, user.userId)) return;
        if (await applyAccountingEffect(tx, final, user.userId)) return;
        await applyInventoryEffect(tx, final, user.userId);
      },
    );
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: `finance.approval_${decision}`, entity_type: approval.entity_type, entity_id: approval.entity_id, fellowship_id: approval.fellowship_id, comment: comment || null, approval_info: { workflowId: approvalId, stage: approval.current_stage, resultingStatus: updated.status } as any } });

    const label = (LABEL[approval.workflow_type] ?? 'request').toLowerCase();
    if (decision === 'approved' && updated.status !== 'FINAL_APPROVED') {
      await this.notify.stage(updated, label, approval.entity_type, approval.entity_id, user.userId);
    } else {
      const outcome = decision === 'approved' ? 'fully approved' : decision === 'returned' ? 'returned for changes' : 'rejected';
      await this.notify.send([approval.created_by], {
        eventType: decision === 'approved' ? 'finance_approved' : decision === 'returned' ? 'finance_returned' : 'finance_rejected',
        title: `${LABEL[approval.workflow_type] ?? 'Request'} ${outcome}`,
        message: `Your ${label} was ${outcome}${comment ? `: ${comment}` : '.'}`,
        entityType: approval.entity_type, entityId: approval.entity_id, fellowshipId: approval.fellowship_id,
      }, user.userId);
      // Ready for payment: tell the Treasurer (central) or the department's leaders (its own money).
      if (decision === 'approved' && ['money_request', 'expense', 'department_expense_major'].includes(approval.workflow_type)) {
        await this.notify.toRoles(approval.fellowship_id!, ['treasurer'], { eventType: 'finance_ready_for_payment', title: 'Ready for payment', message: `An approved ${label} is ready to be paid.`, entityType: approval.entity_type, entityId: approval.entity_id, fellowshipId: approval.fellowship_id }, user.userId);
      }
    }
    return this.summarise(updated);
  }

  async history(user: any, approvalId: string) {
    if (!isUuid(approvalId)) throw new NotFoundException('Approval not found');
    const a = await this.prisma.approval.findFirst({ where: { id: approvalId, fellowship_id: this.scope.fellowship(user) } });
    if (!a || !FINANCE_WORKFLOWS.includes(a.workflow_type)) throw new NotFoundException('Approval not found');
    const events = await this.engine.history(approvalId);
    const users = await this.prisma.user.findMany({ where: { id: { in: events.map((e) => e.actor_user_id).filter((x): x is string => !!x) } }, select: { id: true, first_name: true, last_name: true } });
    const name = new Map(users.map((u) => [u.id, `${u.first_name} ${u.last_name}`]));
    return events.map((e) => ({ action: e.action, stage: e.stage_order, role: e.approver_role, comment: e.comment, at: e.created_at, by: e.actor_user_id ? name.get(e.actor_user_id) ?? null : null }));
  }
}
