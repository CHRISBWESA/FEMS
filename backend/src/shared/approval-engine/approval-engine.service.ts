import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCOUNTING_WORKFLOWS, syncAccountingStatus } from '../../finance/accounting/accounting-sync';
import { INVENTORY_WORKFLOWS, syncInventoryStatus } from '../../inventory/inventory-sync';

export interface WorkflowDefinition {
  workflowType: string;
  stages: {
    stageOrder: number;
    approverRole: string;
    approverUserIds?: string[];
  }[];
}

export interface ApprovalDecision {
  approverUserId: string;
  approverRole: string;
  // 'returned' sends the request back to the submitter for changes; they may revise and resubmit it.
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
}

// Runs INSIDE the decision transaction when the last stage is approved, so a domain side effect
// (applying an approved edit/delete, moving a member, ...) commits or rolls back together with the
// decision itself.
export type FinalApprovalHook = (tx: Prisma.TransactionClient, approval: any) => Promise<void>;

type Db = Prisma.TransactionClient | PrismaService;

const secretaryThenChair = (workflowType: string): WorkflowDefinition => ({
  workflowType,
  stages: [
    { stageOrder: 0, approverRole: 'secretary' },
    { stageOrder: 1, approverRole: 'chairperson' },
  ],
});

const treasurerSecretaryChair = (workflowType: string): WorkflowDefinition => ({
  workflowType,
  stages: [
    { stageOrder: 0, approverRole: 'treasurer' },
    { stageOrder: 1, approverRole: 'secretary' },
    { stageOrder: 2, approverRole: 'chairperson' },
  ],
});

const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  // Treasurer first (can the fellowship afford it?), then the Secretary, then the Chairperson's final approval.
  // Requests created before this order changed keep the stages they were created with.
  money_request: { workflowType: 'money_request', stages: [{ stageOrder: 0, approverRole: 'treasurer' }, { stageOrder: 1, approverRole: 'secretary' }, { stageOrder: 2, approverRole: 'chairperson' }] },
  // A department's activity becomes official after the Fellowship Secretary and then the Chairperson approve it.
  department_activity: secretaryThenChair('department_activity'),
  expense: secretaryThenChair('expense'),
  budget: secretaryThenChair('budget'),
  contribution_edit: secretaryThenChair('contribution_edit'),
  contribution_delete: secretaryThenChair('contribution_delete'),
  income_edit: secretaryThenChair('income_edit'),
  income_delete: secretaryThenChair('income_delete'),
  report: { workflowType: 'report', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  it_content: { workflowType: 'it_content', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  it_content_delete: { workflowType: 'it_content_delete', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'department_chairperson' }] },
  department_transfer: { workflowType: 'department_transfer', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }, { stageOrder: 1, approverRole: 'department_chairperson' }, { stageOrder: 2, approverRole: 'secretary' }] },
  department_removal: { workflowType: 'department_removal', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'department_chairperson' }] },
  role_unassign: { workflowType: 'role_unassign', stages: [{ stageOrder: 0, approverRole: 'chairperson' }] },
  expense_edit: secretaryThenChair('expense_edit'),
  expense_delete: secretaryThenChair('expense_delete'),
  budget_edit: secretaryThenChair('budget_edit'),
  budget_delete: secretaryThenChair('budget_delete'),
  // ---- Finance & projects ----
  // Routine department spending within an approved budget: the Department Chairperson of THAT department.
  department_expense: { workflowType: 'department_expense', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }] },
  // Major department spending, overruns, and anything the Department Chairperson submitted: central approval.
  department_expense_major: treasurerSecretaryChair('department_expense_major'),
  department_budget: treasurerSecretaryChair('department_budget'),
  budget_revision: treasurerSecretaryChair('budget_revision'),
  project: treasurerSecretaryChair('project'),
  project_closure: treasurerSecretaryChair('project_closure'),
  // Earmarking General Fund money for a project (prepared by the Treasurer).
  project_allocation: secretaryThenChair('project_allocation'),
  // Moving money between central and department funds (prepared by the Treasurer).
  fund_transfer: secretaryThenChair('fund_transfer'),
  // Closing a financial year: the Treasurer prepares the statements, the Secretary reviews, the Chairperson approves.
  period_close: secretaryThenChair('period_close'),
  // ---- Resource management ----
  // A department's resource leaving the department's ownership: its Chairperson, then the Treasurer (Resource Manager).
  asset_transfer_department: { workflowType: 'asset_transfer_department', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }, { stageOrder: 1, approverRole: 'treasurer' }] },
  // A fellowship-owned resource becoming a department's own (started by the Treasurer).
  asset_transfer_fellowship: secretaryThenChair('asset_transfer_fellowship'),
  // Disposal / write-off of a fellowship resource: the Treasurer recommends, the Secretary reviews, the Chairperson decides.
  asset_disposal: secretaryThenChair('asset_disposal'),
  // A department's routine disposal: its Chairperson, then the Treasurer.
  asset_disposal_department: { workflowType: 'asset_disposal_department', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }, { stageOrder: 1, approverRole: 'treasurer' }] },
  // A significant department disposal: its Chairperson, the Fellowship Secretary and the Chairperson.
  asset_disposal_major: { workflowType: 'asset_disposal_major', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }, { stageOrder: 1, approverRole: 'secretary' }, { stageOrder: 2, approverRole: 'chairperson' }] },
};

// Approvals scoped to one department (metadata.departmentId): a department_* stage may only be decided by a current
// leader of that department, never by the leader of another department.
const DEPARTMENT_ROLES = new Set(['department_chairperson', 'department_secretary']);

// Money-affecting workflows get segregation of duties: the person who submitted a request may not
// decide any stage of it, and one person may approve at most one stage of the same request (the
// Money Request chain is Treasurer + Secretary + Chairperson - three different people).
const SEPARATION_OF_DUTIES = new Set([
  'money_request', 'expense', 'budget',
  'contribution_edit', 'contribution_delete', 'income_edit', 'income_delete',
  'expense_edit', 'expense_delete', 'budget_edit', 'budget_delete',
  'report', 'it_content', 'it_content_delete', 'role_unassign', 'department_activity',
  'department_expense', 'department_expense_major', 'department_budget', 'budget_revision', 'project',
  'project_closure', 'project_allocation', 'fund_transfer', 'period_close',
  ...INVENTORY_WORKFLOWS,
]);

// For these workflows a rejection ends the request for good; changes are asked for with 'returned' instead.
const FINAL_REJECTION = new Set([
  'money_request', 'report', 'department_activity', 'project', 'project_allocation', 'fund_transfer', 'budget_revision',
]);

// Only the *primary* finance approvals own the entity's approval_status. The *_edit / *_delete
// workflows share the entity id but must never overwrite the record's own status.
const PRIMARY_ENTITY_WORKFLOWS = new Set([
  'expense', 'budget', 'money_request', 'report', 'it_content', 'department_activity',
  'department_expense', 'department_expense_major', 'department_budget',
  ...ACCOUNTING_WORKFLOWS,
  ...INVENTORY_WORKFLOWS,
]);

const DECIDABLE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'RESUBMITTED'];

/** The activity status that corresponds to an approval state (activities have their own lifecycle enum). */
export function activityStatusFor(approvalStatus: string, currentStage: number): string {
  switch (approvalStatus) {
    case 'DRAFT': return 'DRAFT';
    case 'SUBMITTED':
    case 'RESUBMITTED':
    case 'UNDER_REVIEW':
    case 'APPROVED':
      return currentStage === 0 ? 'PENDING_SECRETARY' : 'PENDING_CHAIRPERSON';
    case 'FINAL_APPROVED': return 'APPROVED';
    case 'REJECTED': return 'REJECTED';
    case 'RETURNED': return 'RETURNED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'PENDING_SECRETARY';
  }
}

@Injectable()
export class ApprovalEngineService {
  private readonly logger = new Logger(ApprovalEngineService.name);

  constructor(private prisma: PrismaService) {}

  getWorkflowDefinition(type: string): WorkflowDefinition {
    const def = WORKFLOW_DEFINITIONS[type];
    if (!def) { return null as any; }
    return def;
  }

  async createWorkflow(
    workflowType: string,
    entityId: string,
    entityType: string,
    createdBy: string,
    metadata?: Record<string, any>,
    fellowshipId?: string | null,
    db: Db = this.prisma,
    // skipFirstStage: the person submitting holds the first stage's office for this very record (e.g. a Department
    // Chairperson initiating their own department's transfer) - their initiation is that stage's authorization.
    // autoApprove: no approval is needed - the record is final at once (every stage is recorded as skipped).
    opts: { preparedByTreasurer?: boolean; skipFirstStage?: boolean; autoApprove?: boolean } = {},
  ): Promise<any> {
    const def = this.getWorkflowDefinition(workflowType);
    if (!def) { throw new BadRequestException(`Unknown workflow type: ${workflowType}`); }

    // A Treasurer review stage is the Treasurer's own financial check. When the Treasurer prepared the request, that
    // check is already done, so the stage is recorded as skipped (never "approved" by them) and the request starts
    // with the next, independent approver.
    const skipFirst = def.stages.length > 1 && ((!!opts.preparedByTreasurer && def.stages[0]?.approverRole === 'treasurer') || !!opts.skipFirstStage);

    return db.approval.create({
      data: {
        workflow_type: workflowType,
        entity_id: entityId,
        entity_type: entityType,
        fellowship_id: fellowshipId ?? null,
        metadata: (metadata || undefined) as any,
        current_stage: 0,
        status: opts.autoApprove ? 'FINAL_APPROVED' : 'DRAFT',
        created_by: createdBy,
        steps: {
          create: def.stages.map((stage, i) => ({
            stage_order: stage.stageOrder,
            approver_role: stage.approverRole,
            approver_user_id: stage.approverUserIds ? stage.approverUserIds[0] : undefined,
            status: opts.autoApprove || (skipFirst && i === 0) ? 'skipped' : 'pending',
            comment: opts.autoApprove ? 'No approval needed' : skipFirst && i === 0 ? (opts.skipFirstStage ? 'Initiated by the office holder' : 'Prepared by the Treasurer') : undefined,
          })),
        },
      },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
  }

  async submit(approvalId: string, db: Db = this.prisma, actorUserId?: string): Promise<any> {
    const approval = await db.approval.findUnique({ where: { id: approvalId } });
    if (!approval) { throw new BadRequestException('Approval record not found'); }
    if (approval.status !== 'DRAFT') { throw new BadRequestException('Already submitted'); }
    const updated = await db.approval.update({
      where: { id: approvalId },
      data: { status: 'SUBMITTED', current_stage: await this.firstOpenStage(db, approvalId) },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
    await this.recordEvent(db, approval, 'submitted', actorUserId ?? approval.created_by);
    return updated;
  }

  /** The first stage that still needs a decision (stages skipped at creation are passed over). */
  private async firstOpenStage(db: Db, approvalId: string): Promise<number> {
    const first = await db.approvalStep.findFirst({
      where: { approval_id: approvalId, status: { not: 'skipped' } },
      orderBy: { stage_order: 'asc' },
      select: { stage_order: true },
    });
    return first?.stage_order ?? 0;
  }

  /** Append-only history: every submission and decision is kept, even after a resubmission resets the steps. */
  private async recordEvent(
    db: Db,
    approval: { id: string; fellowship_id: string | null },
    action: string,
    actorUserId: string | null,
    extra: { stageOrder?: number; approverRole?: string; comment?: string | null } = {},
  ): Promise<void> {
    await db.approvalEvent.create({
      data: {
        approval_id: approval.id,
        fellowship_id: approval.fellowship_id,
        action,
        stage_order: extra.stageOrder ?? null,
        approver_role: extra.approverRole ?? null,
        comment: extra.comment || null,
        actor_user_id: actorUserId,
      },
    });
  }

  /** The full history of one approval, oldest first. */
  async history(approvalId: string): Promise<any[]> {
    return this.prisma.approvalEvent.findMany({ where: { approval_id: approvalId }, orderBy: { created_at: 'asc' } });
  }

  async getWorkflowForUser(approvalId: string, userId: string, userRoles: string[]): Promise<any> {
    const approval = await this.prisma.approval.findUnique({
      where: { id: approvalId },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
    if (!approval) { throw new BadRequestException('Not found'); }
    const currentStage = approval.steps.find((s) => s.stage_order === approval.current_stage);
    if (!currentStage) { throw new BadRequestException('Invalid stage'); }
    const isDesignatedApprover = currentStage.approver_user_id === userId;
    const roleIsChair = currentStage.approver_role === 'chairperson' || currentStage.approver_role === 'assistant_chairperson';
    const roleIsSecretary = currentStage.approver_role === 'secretary';
    const hasApproverRole = userRoles.includes(currentStage.approver_role) ||
      (roleIsChair && (userRoles.includes('chairperson') || userRoles.includes('assistant_chairperson'))) ||
      (roleIsSecretary && (userRoles.includes('secretary') || userRoles.includes('assistant_secretary')));
    const isAuthorized = hasApproverRole && (isDesignatedApprover || currentStage.approver_user_id === null);
    if (!isAuthorized) { throw new ForbiddenException('Not authorized'); }
    await this.assertDepartmentApprover(approval, currentStage.approver_role, userId);
    return approval;
  }

  /** A department stage of a department-scoped approval belongs to that department's current leaders only. */
  private async assertDepartmentApprover(approval: any, stageRole: string, userId: string): Promise<void> {
    const departmentId = (approval.metadata as any)?.departmentId;
    if (!DEPARTMENT_ROLES.has(stageRole) || !departmentId) return;
    const leads = await this.prisma.departmentLeader.findFirst({
      where: { department_id: departmentId, user_id: userId, active_role: stageRole },
      select: { id: true },
    });
    if (!leads) { throw new ForbiddenException('Only a current leader of this department can decide this stage.'); }
  }

  // Maps the engine's status to the value stored on the finance entity: an intermediate approval is
  // "under review" - the entity is only FINAL_APPROVED once EVERY stage has approved.
  private entityStatusFor(approvalStatus: string): any {
    return approvalStatus === 'APPROVED' ? 'UNDER_REVIEW' : approvalStatus;
  }

  private async syncEntityStatus(tx: Prisma.TransactionClient, approval: any, approvalStatus: string, currentStage = 0): Promise<void> {
    if (!PRIMARY_ENTITY_WORKFLOWS.has(approval.workflow_type)) return;
    // Bound to this exact workflow so a mismatched entity id can never be touched.
    const where = { id: approval.entity_id, approval_workflow_id: approval.id };
    if (approval.workflow_type === 'department_activity') {
      await tx.activity.updateMany({ where, data: { status: activityStatusFor(approvalStatus, currentStage) as any } });
      return;
    }
    if (ACCOUNTING_WORKFLOWS.includes(approval.workflow_type)) {
      await syncAccountingStatus(tx, approval, approvalStatus);
      return;
    }
    if (INVENTORY_WORKFLOWS.includes(approval.workflow_type)) {
      await syncInventoryStatus(tx, approval, approvalStatus);
      return;
    }
    const data = { approval_status: this.entityStatusFor(approvalStatus) };
    switch (approval.workflow_type) {
      case 'expense':
      case 'department_expense':
      case 'department_expense_major':
        await tx.expense.updateMany({ where, data }); break;
      case 'budget':
      case 'department_budget':
        await tx.budget.updateMany({ where, data }); break;
      case 'money_request': await tx.moneyRequest.updateMany({ where, data }); break;
      case 'report': await tx.report.updateMany({ where, data: { status: data.approval_status } }); break;
      case 'it_content': await tx.documentEntity.updateMany({ where, data }); break;
    }
  }

  // The decision is race-safe: the authorization read happens first, but the WRITES are conditional
  // ("only if this step is still pending and the approval is still at this stage/status") and run in
  // one transaction. Two concurrent deciders can therefore never both succeed - the loser gets a 409
  // and its partial writes roll back - so a final-approval side effect can never run twice.
  async decide(approvalId: string, decision: ApprovalDecision, onFinal?: FinalApprovalHook): Promise<any> {
    const approval = await this.getWorkflowForUser(approvalId, decision.approverUserId, [decision.approverRole]);
    if (approval.status === 'FINAL_APPROVED') { throw new BadRequestException('Already finalized'); }
    if (!DECIDABLE_STATUSES.includes(approval.status)) {
      throw new BadRequestException(`This request is ${approval.status.toLowerCase().replace(/_/g, ' ')} and cannot be decided`);
    }
    const currentStage = approval.steps.find((s: any) => s.stage_order === approval.current_stage);
    if (currentStage.status !== 'pending') { throw new BadRequestException('Step already completed'); }

    if (SEPARATION_OF_DUTIES.has(approval.workflow_type)) {
      if (approval.created_by === decision.approverUserId) {
        throw new ForbiddenException('You cannot decide on a request that you submitted.');
      }
      if (approval.steps.some((s: any) => s.status === 'approved' && s.acted_by === decision.approverUserId)) {
        throw new ForbiddenException('You have already approved an earlier stage of this request; a different person must approve this stage.');
      }
    }

    let nextStatus: string;
    let nextStage = approval.current_stage;
    let stepStatus: 'approved' | 'rejected' | 'returned';

    if (decision.decision === 'approved') {
      stepStatus = 'approved';
      const isLastStage = approval.current_stage === approval.steps.length - 1;
      if (isLastStage) { nextStatus = 'FINAL_APPROVED'; }
      else { nextStatus = 'APPROVED'; nextStage = approval.current_stage + 1; }
    } else if (decision.decision === 'returned') {
      stepStatus = 'returned';
      nextStatus = 'RETURNED';
    } else if (decision.decision === 'rejected') {
      stepStatus = 'rejected';
      nextStatus = 'REJECTED';
    } else {
      throw new BadRequestException("decision must be 'approved', 'returned' or 'rejected'");
    }

    return this.prisma.$transaction(async (tx) => {
      const stepWrite = await tx.approvalStep.updateMany({
        where: { id: currentStage.id, status: 'pending' },
        data: { status: stepStatus, comment: decision.comment, acted_at: new Date(), acted_by: decision.approverUserId },
      });
      if (stepWrite.count !== 1) {
        throw new ConflictException('This step was decided by someone else. Refresh and try again.');
      }
      const approvalWrite = await tx.approval.updateMany({
        where: { id: approvalId, current_stage: approval.current_stage, status: { in: DECIDABLE_STATUSES as any } },
        data: { status: nextStatus as any, current_stage: nextStage },
      });
      if (approvalWrite.count !== 1) {
        throw new ConflictException('This request changed while you were deciding. Refresh and try again.');
      }

      await this.syncEntityStatus(tx, approval, nextStatus, nextStage);
      await this.recordEvent(tx, approval, stepStatus, decision.approverUserId, {
        stageOrder: approval.current_stage,
        approverRole: currentStage.approver_role,
        comment: decision.comment,
      });

      const updated = await tx.approval.findUniqueOrThrow({
        where: { id: approvalId },
        include: { steps: { orderBy: { stage_order: 'asc' } } },
      });
      if (nextStatus === 'FINAL_APPROVED' && onFinal) {
        await onFinal(tx, updated);
      }
      return updated;
    });
  }

  /**
   * Reopens a request at the first stage. A request returned for revision can always be reopened; a REJECTED one
   * only for workflows where rejection is not final. `anyRequester` lets a caller that has already checked the
   * user may act for the same department (e.g. a co-leader) resubmit on the original submitter's behalf.
   */
  async resubmit(
    approvalId: string,
    userId: string,
    _userRoles: string[],
    opts: { anyRequester?: boolean; db?: Prisma.TransactionClient } = {},
  ): Promise<any> {
    const run = async (tx: Prisma.TransactionClient) => {
      const approval = await tx.approval.findUnique({ where: { id: approvalId } });
      if (!approval) { throw new BadRequestException('Not found'); }
      if (!opts.anyRequester && approval.created_by !== userId) { throw new ForbiddenException('Only requester can resubmit'); }
      const reopenable = FINAL_REJECTION.has(approval.workflow_type) ? ['RETURNED'] : ['RETURNED', 'REJECTED'];
      if (!reopenable.includes(approval.status)) {
        throw new BadRequestException(
          approval.status === 'REJECTED'
            ? 'A rejected request cannot be resubmitted.'
            : 'Only a request returned for revision can be resubmitted.',
        );
      }
      const firstStage = await this.firstOpenStage(tx, approvalId);
      const reopened = await tx.approval.updateMany({
        where: { id: approvalId, status: approval.status },
        data: { status: 'RESUBMITTED', current_stage: firstStage },
      });
      if (reopened.count !== 1) {
        throw new ConflictException('This request was already resubmitted.');
      }
      // Earlier decisions stay in approval_events; the steps start fresh for the new review round. Stages skipped
      // when the request was created stay skipped.
      await tx.approvalStep.updateMany({
        where: { approval_id: approvalId, status: { not: 'skipped' } },
        data: { status: 'pending', comment: null, acted_at: null, acted_by: null },
      });
      await this.syncEntityStatus(tx, approval, 'RESUBMITTED', firstStage);
      await this.recordEvent(tx, approval, 'resubmitted', userId);
      return tx.approval.findUniqueOrThrow({
        where: { id: approvalId },
        include: { steps: { orderBy: { stage_order: 'asc' } } },
      });
    };
    return opts.db ? run(opts.db) : this.prisma.$transaction(run);
  }

  async cancel(approvalId: string, actorUserId?: string, db?: Prisma.TransactionClient): Promise<any> {
    const run = async (tx: Prisma.TransactionClient) => {
      const approval = await tx.approval.findUnique({ where: { id: approvalId } });
      if (!approval) { throw new BadRequestException('Not found'); }
      const updated = await tx.approval.update({
        where: { id: approvalId },
        data: { status: 'CANCELLED' },
        include: { steps: { orderBy: { stage_order: 'asc' } } },
      });
      await this.syncEntityStatus(tx, approval, 'CANCELLED', approval.current_stage);
      await this.recordEvent(tx, approval, 'cancelled', actorUserId ?? null);
      return updated;
    };
    return db ? run(db) : this.prisma.$transaction(run);
  }

  async getDefinition(workflowType: string): Promise<WorkflowDefinition | undefined> {
    return WORKFLOW_DEFINITIONS[workflowType];
  }
}
