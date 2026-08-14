import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contribution, Expense, Budget, MoneyRequest } from '../shared/schemas/finance.schema';
import { Approval } from '../shared/schemas/system.schema';
import { Member } from '../shared/schemas/members-departments.schema';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';

export interface CreateContributionDto {
  memberId: string;
  amount: number;
  contributionType: string;
  date: Date;
}

export interface CreateExpenseDto {
  title: string;
  description?: string;
  amount: number;
  date: Date;
  departmentId?: string;
  purpose: string;
}

export interface CreateBudgetDto {
  title: string;
  description?: string;
  amount: number;
  departmentId?: string;
  fiscalYear: string;
}

export interface CreateMoneyRequestDto {
  departmentId?: string;
  title: string;
  description?: string;
  amount: number;
  purpose: string;
}

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Contribution.name) private contributionModel: Model<Contribution>,
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(Budget.name) private budgetModel: Model<Budget>,
    @InjectModel(MoneyRequest.name) private moneyRequestModel: Model<MoneyRequest>,
    @InjectModel(Approval.name) private approvalModel: Model<Approval>,
    @InjectModel(Member.name) private memberModel: Model<Member>,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  private checkRole(roles: string[], requiredRole: string): boolean {
    return roles.includes(requiredRole);
  }

  private hasAnyRole(roles: string[], requiredRoles: string[]): boolean {
    return requiredRoles.some((r) => roles.includes(r));
  }

  // === CONTRIBUTIONS ===
  async findAllContributions(currentUser: any): Promise<Contribution[]> {
    const roles: string[] = currentUser.roles || [];
    const isAllowed = this.hasAnyRole(roles, ['secretary', 'admin', 'assistant_secretary', 'chairperson', 'assistant_chairperson']) ||
      roles.includes('treasurer');
    if (!isAllowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.contributionModel.find().sort({ date: -1 }).exec();
  }

  async recordContribution(dto: CreateContributionDto, currentUser: any): Promise<Contribution> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer or Secretary can record contributions.');
    }

    const contribution = await this.contributionModel.create({
      ...dto,
      member_id: new Types.ObjectId(dto.memberId),
      recorded_by: new Types.ObjectId(currentUser.userId),
      recorded_at: new Date(),
      approval_status: 'FINAL_APPROVED',
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.contribution_create',
      entityType: 'contribution',
      entityId: contribution._id.toString(),
      newValue: { amount: dto.amount, type: dto.contributionType, date: dto.date },
    });

    return contribution;
  }

  async requestContributionEdit(id: string, dto: Partial<CreateContributionDto> & { reason: string }, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request contribution edits.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'contribution_edit',
      id,
      'contribution',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.contribution_edit_requested',
      entityType: 'contribution',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
      comment: dto.reason,
    });

    return approval;
  }

  async requestContributionDelete(id: string, reason: string, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request contribution deletion.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'contribution_edit',
      id,
      'contribution_delete',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.contribution_delete_requested',
      entityType: 'contribution',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
      comment: reason,
    });

    return approval;
  }

  // === EXPENSES ===
  async findAllExpenses(currentUser: any): Promise<Expense[]> {
    const roles: string[] = currentUser.roles || [];
    const isAllowed = this.hasAnyRole(roles, ['secretary', 'admin', 'assistant_secretary', 'treasurer', 'chairperson', 'assistant_chairperson']);
    if (!isAllowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.expenseModel.find().sort({ date: -1 }).exec();
  }

  async createExpense(dto: CreateExpenseDto, currentUser: any): Promise<Expense> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer, Secretary, or Admin can create expenses.');
    }

    const expense = await this.expenseModel.create({
      ...dto,
      recorded_by: new Types.ObjectId(currentUser.userId),
      approval_status: 'SUBMITTED',
    });

    const approval = await this.approvalEngine.createWorkflow(
      'expense',
      expense._id.toString(),
      'expense',
      currentUser.userId,
    );
    expense.approval_workflow_id = approval._id;
    await expense.save();
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.expense_create',
      entityType: 'expense',
      entityId: expense._id.toString(),
      newValue: { amount: dto.amount, title: dto.title },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    // Notify Secretary + Chairperson
    const approvers = await this.findUsersWithRole(['secretary', 'chairperson', 'assistant_secretary', 'assistant_chairperson']);
    for (const userId of approvers) {
      await this.notificationEngine.create({
        recipientUserId: userId,
        eventType: 'finance_request',
        title: 'Expense Approval Needed',
        message: `Expense "${dto.title}" requires your approval.`,
        entityType: 'expense',
        entityId: expense._id.toString(),
      });
    }

    return expense;
  }

  async approveExpense(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<Expense> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');

    if (!isSecretary && !isChair) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const expense = await this.expenseModel.findById(id).exec();
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    if (!expense.approval_workflow_id) {
      throw new BadRequestException('No approval workflow for this expense.');
    }

    await this.approvalEngine.decide(expense.approval_workflow_id.toString(), {
      approverUserId: currentUser.userId,
      approverRole: isSecretary ? 'secretary' : 'chairperson',
      decision,
      comment,
    });

    const updated = await this.expenseModel.findById(id).exec();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.expense_approve',
      entityType: 'expense',
      entityId: id,
      approvalInfo: { decision, comment, stage: expense.approval_workflow_id.toString() },
    });

    if (decision === 'approved') {
      updated.approval_status = 'FINAL_APPROVED';
      await updated.save();

      await this.notificationEngine.create({
        recipientUserId: expense.recorded_by.toString(),
        eventType: 'finance_approved',
        title: 'Expense Approved',
        message: `Expense "${expense.title}" was approved: ${comment || ''}`,
        entityType: 'expense',
        entityId: id,
      });
    } else {
      updated.approval_status = 'REJECTED';
      await updated.save();
    }

    return updated;
  }

  async editExpense(id: string, dto: Partial<CreateExpenseDto>, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request expense edits.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'expense_edit',
      id,
      'expense',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.expense_edit',
      entityType: 'expense',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return approval;
  }

  async deleteExpense(id: string, reason: string, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request expense deletion.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'expense_delete',
      id,
      'expense',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.expense_delete',
      entityType: 'expense',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return approval;
  }

  // === BUDGETS ===
  async findAllBudgets(currentUser: any): Promise<Budget[]> {
    const roles: string[] = currentUser.roles || [];
    const isAllowed = this.hasAnyRole(roles, ['secretary', 'admin', 'assistant_secretary', 'treasurer', 'chairperson', 'assistant_chairperson']);
    if (!isAllowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.budgetModel.find().sort({ created_at: -1 }).exec();
  }

  async createBudget(dto: CreateBudgetDto, currentUser: any): Promise<Budget> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer or Secretary can create budgets.');
    }

    const budget = await this.budgetModel.create({
      ...dto,
      created_by: new Types.ObjectId(currentUser.userId),
      approval_status: 'SUBMITTED',
    });

    const approval = await this.approvalEngine.createWorkflow(
      'budget',
      budget._id.toString(),
      'budget',
      currentUser.userId,
    );
    budget.approval_workflow_id = approval._id;
    await budget.save();
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.budget_create',
      entityType: 'budget',
      entityId: budget._id.toString(),
      newValue: { amount: dto.amount, title: dto.title },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return budget;
  }

  async approveBudget(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<Budget> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');

    if (!isSecretary && !isChair) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const budget = await this.budgetModel.findById(id).exec();
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }
    if (!budget.approval_workflow_id) {
      throw new BadRequestException('No approval workflow.');
    }

    await this.approvalEngine.decide(budget.approval_workflow_id.toString(), {
      approverUserId: currentUser.userId,
      approverRole: isSecretary ? 'secretary' : 'chairperson',
      decision,
      comment,
    });

    const updated = await this.budgetModel.findById(id).exec();
    if (decision === 'approved') {
      updated.approval_status = 'FINAL_APPROVED';
      await updated.save();
    } else {
      updated.approval_status = 'REJECTED';
      await updated.save();
    }

    return updated;
  }

  async editBudget(id: string, dto: Partial<CreateBudgetDto>, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request budget edits.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'budget_edit',
      id,
      'budget',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.budget_edit',
      entityType: 'budget',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return approval;
  }

  async deleteBudget(id: string, reason: string, currentUser: any): Promise<Approval> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('treasurer') && !roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('Only Treasurer can request budget deletion.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'budget_delete',
      id,
      'budget',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.budget_delete',
      entityType: 'budget',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return approval;
  }

  // === MONEY REQUESTS ===
  async findAllMoneyRequests(currentUser: any): Promise<MoneyRequest[]> {
    const roles: string[] = currentUser.roles || [];
    const isAllowed = this.hasAnyRole(roles, ['secretary', 'admin', 'assistant_secretary', 'treasurer', 'chairperson', 'assistant_chairperson']);
    if (!isAllowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.moneyRequestModel.find().sort({ created_at: -1 }).exec();
  }

  async createMoneyRequest(dto: CreateMoneyRequestDto, currentUser: any): Promise<MoneyRequest> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    const isDeptLeader = roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isSecretary && !isDeptLeader) {
      throw new ForbiddenException('Only Secretary or Department Leaders can create money requests.');
    }

    const request = await this.moneyRequestModel.create({
      ...dto,
      requester_id: new Types.ObjectId(currentUser.userId),
      approval_status: 'SUBMITTED',
    });

    const approval = await this.approvalEngine.createWorkflow(
      'money_request',
      request._id.toString(),
      'money_request',
      currentUser.userId,
    );
    request.approval_workflow_id = approval._id;
    await request.save();
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.money_request_create',
      entityType: 'money_request',
      entityId: request._id.toString(),
      newValue: { amount: dto.amount, title: dto.title },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    // Notify Secretary
    const secretaries = await this.findUsersWithRole(['secretary', 'assistant_secretary']);
    for (const userId of secretaries) {
      await this.notificationEngine.create({
        recipientUserId: userId,
        eventType: 'approval_request',
        title: 'Money Request Approval',
        message: `Money request "${dto.title}" requires your approval.`,
        entityType: 'money_request',
        entityId: request._id.toString(),
      });
    }

    return request;
  }

  async approveMoneyRequest(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<MoneyRequest> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');
    const isTreasurer = roles.includes('treasurer');

    if (!isSecretary && !isChair && !isTreasurer) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const request = await this.moneyRequestModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException('Money request not found');
    }
    if (!request.approval_workflow_id) {
      throw new BadRequestException('No approval workflow.');
    }

    await this.approvalEngine.decide(request.approval_workflow_id.toString(), {
      approverUserId: currentUser.userId,
      approverRole: isSecretary ? 'secretary' : (isChair ? 'chairperson' : 'treasurer'),
      decision,
      comment,
    });

    const updated = await this.moneyRequestModel.findById(id).exec();
    if (decision === 'approved') {
      updated.approval_status = 'FINAL_APPROVED';
      await updated.save();

      await this.notificationEngine.create({
        recipientUserId: request.requester_id.toString(),
        eventType: 'finance_approved',
        title: 'Money Request Approved',
        message: `Your money request "${request.title}" was approved: ${comment || ''}`,
        entityType: 'money_request',
        entityId: id,
      });
    } else {
      updated.approval_status = 'REJECTED';
      await updated.save();

      await this.notificationEngine.create({
        recipientUserId: request.requester_id.toString(),
        eventType: 'finance_approved',
        title: 'Money Request Rejected',
        message: `Your money request "${request.title}" was rejected: ${comment || 'Please correct and resubmit.'}`,
        entityType: 'money_request',
        entityId: id,
      });
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.money_request_approve',
      entityType: 'money_request',
      entityId: id,
      approvalInfo: { decision, comment },
    });

    return updated;
  }

  async resubmitMoneyRequest(id: string, currentUser: any): Promise<MoneyRequest> {
    const request = await this.moneyRequestModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException('Money request not found');
    }
    if (request.requester_id.toString() !== currentUser.userId) {
      throw new ForbiddenException('Only the requester can resubmit.');
    }
    if (request.approval_status !== 'REJECTED') {
      throw new BadRequestException('Request is not in rejected state.');
    }

    request.approval_status = 'RESUBMITTED';
    await request.save();

    if (request.approval_workflow_id) {
      await this.approvalEngine.resubmit(
        request.approval_workflow_id.toString(),
        currentUser.userId,
        currentUser.roles || [],
      );
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'finance.money_request_resubmit',
      entityType: 'money_request',
      entityId: id,
    });

    return request;
  }

  private async findUsersWithRole(roles: string[]): Promise<string[]> {
    return [];
  }
}
