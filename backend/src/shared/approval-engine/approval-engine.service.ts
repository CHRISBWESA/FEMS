import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Approval, ApprovalStep } from '../../shared/schemas/system.schema';
import { Model, Types } from 'mongoose';

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
  decision: 'approved' | 'rejected';
  comment?: string;
}

const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  money_request: { workflowType: 'money_request', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }, { stageOrder: 2, approverRole: 'treasurer' }] },
  expense: { workflowType: 'expense', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  budget: { workflowType: 'budget', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  contribution_edit: { workflowType: 'contribution_edit', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  report: { workflowType: 'report', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  it_content: { workflowType: 'it_content', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  it_content_delete: { workflowType: 'it_content_delete', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'department_chairperson' }] },
  department_transfer: { workflowType: 'department_transfer', stages: [{ stageOrder: 0, approverRole: 'department_chairperson' }, { stageOrder: 1, approverRole: 'department_chairperson' }, { stageOrder: 2, approverRole: 'secretary' }] },
  department_removal: { workflowType: 'department_removal', stages: [{ stageOrder: 0, approverRole: 'department_secretary' }, { stageOrder: 1, approverRole: 'department_chairperson' }] },
  expense_edit: { workflowType: 'expense_edit', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  expense_delete: { workflowType: 'expense_delete', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  budget_edit: { workflowType: 'budget_edit', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
  budget_delete: { workflowType: 'budget_delete', stages: [{ stageOrder: 0, approverRole: 'secretary' }, { stageOrder: 1, approverRole: 'chairperson' }] },
};

@Injectable()
export class ApprovalEngineService {
  private readonly logger = new Logger(ApprovalEngineService.name);

  constructor(@InjectModel(Approval.name) private approvalModel: Model<Approval>) {}

  getWorkflowDefinition(type: string): WorkflowDefinition {
    const def = WORKFLOW_DEFINITIONS[type];
    if (!def) { return null as any; }
    return def;
  }

  async createWorkflow(workflowType: string, entityId: string, entityType: string, createdBy: string): Promise<any> {
    const def = this.getWorkflowDefinition(workflowType);
    const steps: any[] = def.stages.map((stage) => ({
      stage_order: stage.stageOrder,
      approver_role: stage.approverRole,
      approver_user_id: stage.approverUserIds ? new Types.ObjectId(stage.approverUserIds[0]) : undefined,
      status: 'pending',
    }));

    return this.approvalModel.create({
      workflow_type: workflowType,
      entity_id: new Types.ObjectId(entityId),
      entity_type: entityType,
      current_stage: 0,
      status: 'DRAFT',
      created_by: new Types.ObjectId(createdBy),
      steps,
    });
  }

  async submit(approvalId: string): Promise<any> {
    const approval: any = await this.approvalModel.findById(approvalId).exec();
    if (!approval) { throw new BadRequestException('Approval record not found'); }
    if (approval.status !== 'DRAFT') { throw new BadRequestException('Already submitted'); }
    approval.status = 'SUBMITTED';
    approval.current_stage = 0;
    await approval.save();
    return approval;
  }

  async getWorkflowForUser(approvalId: string, userId: string, userRoles: string[]): Promise<any> {
    const approval: any = await this.approvalModel.findById(approvalId).exec();
    if (!approval) { throw new BadRequestException('Not found'); }
    const currentStage = approval.steps[approval.current_stage];
    if (!currentStage) { throw new BadRequestException('Invalid stage'); }
    const isDesignatedApprover = currentStage.approver_user_id?.toString() === userId;
    const hasApproverRole = userRoles.includes(currentStage.approver_role);
    const roleIsChair = currentStage.approver_role === 'chairperson' || currentStage.approver_role === 'assistant_chairperson';
    const hasChairRole = userRoles.includes('chairperson') || userRoles.includes('assistant_chairperson');
    const isAuthorized = isDesignatedApprover || (hasApproverRole && !roleIsChair && !hasChairRole) || (roleIsChair && hasChairRole);
    if (!isAuthorized) { throw new ForbiddenException('Not authorized'); }
    return approval;
  }

  async decide(approvalId: string, decision: ApprovalDecision): Promise<any> {
    const approval: any = await this.getWorkflowForUser(approvalId, decision.approverUserId, [decision.approverRole]);
    if (approval.status === 'FINAL_APPROVED') { throw new BadRequestException('Already finalized'); }
    const currentStage = approval.steps[approval.current_stage];
    if (currentStage.status !== 'pending') { throw new BadRequestException('Step already completed'); }
    if (decision.decision === 'approved') {
      currentStage.status = 'approved';
      currentStage.comment = decision.comment;
      currentStage.acted_at = new Date();
      currentStage.acted_by = new Types.ObjectId(decision.approverUserId);
      const isLastStage = approval.current_stage === approval.steps.length - 1;
      if (isLastStage) { approval.status = 'FINAL_APPROVED'; }
      else { approval.status = 'APPROVED'; approval.current_stage += 1; }
    } else {
      currentStage.status = 'rejected';
      currentStage.comment = decision.comment;
      currentStage.acted_at = new Date();
      currentStage.acted_by = new Types.ObjectId(decision.approverUserId);
      approval.status = 'REJECTED';
    }
    await approval.save();
    return approval;
  }

  async resubmit(approvalId: string, userId: string, userRoles: string[]): Promise<any> {
    const approval: any = await this.approvalModel.findById(approvalId).exec();
    if (!approval) { throw new BadRequestException('Not found'); }
    if (approval.created_by.toString() !== userId) { throw new ForbiddenException('Only requester can resubmit'); }
    if (approval.status !== 'REJECTED') { throw new BadRequestException('Not in rejected state'); }
    approval.status = 'RESUBMITTED';
    approval.current_stage = 0;
    approval.steps.forEach((step: any) => { step.status = 'pending'; step.comment = undefined; step.acted_at = undefined; step.acted_by = undefined; });
    await approval.save();
    return approval;
  }

  async cancel(approvalId: string): Promise<any> {
    const approval: any = await this.approvalModel.findById(approvalId).exec();
    if (!approval) { throw new BadRequestException('Not found'); }
    approval.status = 'CANCELLED';
    await approval.save();
    return approval;
  }

  async getDefinition(workflowType: string): Promise<WorkflowDefinition | undefined> {
    return WORKFLOW_DEFINITIONS[workflowType];
  }
}
