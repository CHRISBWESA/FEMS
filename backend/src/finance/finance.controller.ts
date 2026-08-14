import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { FinanceService, CreateContributionDto, CreateExpenseDto, CreateBudgetDto, CreateMoneyRequestDto } from './finance.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // === Contributions ===
  @Get('contributions')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async getContributions(@Req() req) {
    return this.financeService.findAllContributions(req.user);
  }

  @Post('contributions')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY)
  async createContribution(@Body() body: CreateContributionDto, @Req() req) {
    return this.financeService.recordContribution(body, req.user);
  }

  @Post('contributions/:id/edit-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY)
  async requestEdit(@Param('id') id: string, @Body() body: { amount?: number; contributionType?: string; date?: Date; reason: string }, @Req() req) {
    return this.financeService.requestContributionEdit(id, { ...body, memberId: '', contributionType: body.contributionType || '', amount: body.amount || 0, date: body.date || new Date() }, req.user);
  }

  @Post('contributions/:id/delete-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY)
  async requestDelete(@Param('id') id: string, @Body() body: { reason: string }, @Req() req) {
    return this.financeService.requestContributionDelete(id, body.reason, req.user);
  }

  // === Expenses ===
  @Get('expenses')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async getExpenses(@Req() req) {
    return this.financeService.findAllExpenses(req.user);
  }

  @Post('expenses')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY)
  async createExpense(@Body() body: CreateExpenseDto, @Req() req) {
    return this.financeService.createExpense(body, req.user);
  }

  @Post('expenses/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async approveExpense(@Param('id') id: string, @Body() body: { decision: 'approved' | 'rejected'; comment?: string }, @Req() req) {
    return this.financeService.approveExpense(id, body.decision, body.comment || '', req.user);
  }

  @Post('expenses/:id/edit-request')
  @Roles(ROLES.TREASURER)
  async requestExpenseEdit(@Param('id') id: string, @Body() body: Partial<CreateExpenseDto> & { reason: string }, @Req() req) {
    return this.financeService.editExpense(id, body, req.user);
  }

  @Post('expenses/:id/delete-request')
  @Roles(ROLES.TREASURER)
  async requestExpenseDelete(@Param('id') id: string, @Body() body: { reason: string }, @Req() req) {
    return this.financeService.deleteExpense(id, body.reason, req.user);
  }

  // === Budgets ===
  @Get('budgets')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async getBudgets(@Req() req) {
    return this.financeService.findAllBudgets(req.user);
  }

  @Post('budgets')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY)
  async createBudget(@Body() body: CreateBudgetDto, @Req() req) {
    return this.financeService.createBudget(body, req.user);
  }

  @Post('budgets/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async approveBudget(@Param('id') id: string, @Body() body: { decision: 'approved' | 'rejected'; comment?: string }, @Req() req) {
    return this.financeService.approveBudget(id, body.decision, body.comment || '', req.user);
  }

  @Post('budgets/:id/edit-request')
  @Roles(ROLES.TREASURER)
  async requestBudgetEdit(@Param('id') id: string, @Body() body: Partial<CreateBudgetDto> & { reason: string }, @Req() req) {
    return this.financeService.editBudget(id, body, req.user);
  }

  @Post('budgets/:id/delete-request')
  @Roles(ROLES.TREASURER)
  async requestBudgetDelete(@Param('id') id: string, @Body() body: { reason: string }, @Req() req) {
    return this.financeService.deleteBudget(id, body.reason, req.user);
  }

  // === Money Requests ===
  @Get('money-requests')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async getMoneyRequests(@Req() req) {
    return this.financeService.findAllMoneyRequests(req.user);
  }

  @Post('money-requests')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async createMoneyRequest(@Body() body: CreateMoneyRequestDto, @Req() req) {
    return this.financeService.createMoneyRequest(body, req.user);
  }

  @Post('money-requests/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.TREASURER)
  async approveMoneyRequest(@Param('id') id: string, @Body() body: { decision: 'approved' | 'rejected'; comment?: string }, @Req() req) {
    return this.financeService.approveMoneyRequest(id, body.decision, body.comment || '', req.user);
  }

  @Post('money-requests/:id/resubmit')
  @Roles(ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async resubmitMoneyRequest(@Param('id') id: string, @Req() req) {
    return this.financeService.resubmitMoneyRequest(id, req.user);
  }
}
