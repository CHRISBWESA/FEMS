import { Controller, Get, Post, Body, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  FinanceService,
  CreateContributionDto,
  CreateExpenseDto,
  CreateBudgetDto,
  CreateMoneyRequestDto,
  ListQuery,
} from './finance.service';
import { FinanceReleaseService, ReleaseMoneyRequestDto } from './finance-release.service';
import { FinanceIncomeService, CreateIncomeDto } from './finance-income.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

const VIEWERS = [ROLES.ADMIN, ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON];
const VIEWERS_AND_DEPT = [...VIEWERS, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON];

// Lists return a plain array (unchanged contract) and put the total in X-Total-Count for pagination.
function withTotal<T>(res: Response, result: { data: T[]; total: number }): T[] {
  res.setHeader('X-Total-Count', String(result.total));
  return result.data;
}

@RequiresModule('finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly releaseService: FinanceReleaseService,
    private readonly incomeService: FinanceIncomeService,
  ) {}

  // === Contributions ===
  @Get('contributions')
  @Roles(...VIEWERS)
  async getContributions(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllContributions(req.user, query));
  }

  @Post('contributions')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async createContribution(@Body() body: CreateContributionDto, @Req() req) {
    return this.financeService.recordContribution(body, req.user);
  }

  @Post('contributions/:id/edit-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestEdit(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.requestContributionEdit(id, body, req.user);
  }

  @Post('contributions/:id/delete-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestDelete(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.requestContributionDelete(id, body, req.user);
  }

  // === Income (non-member income) ===
  @Get('income')
  @Roles(...VIEWERS)
  async getIncome(@Req() req, @Query() query: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.incomeService.list(req.user, query));
  }

  @Post('income')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async createIncome(@Body() body: CreateIncomeDto, @Req() req) {
    return this.incomeService.create(body, req.user);
  }

  @Post('income/:id/edit-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestIncomeEdit(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.editIncome(id, body, req.user);
  }

  @Post('income/:id/delete-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestIncomeDelete(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.deleteIncome(id, body, req.user);
  }

  // === Expenses ===
  @Get('expenses')
  @Roles(...VIEWERS_AND_DEPT)
  async getExpenses(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllExpenses(req.user, query));
  }

  @Post('expenses')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async createExpense(@Body() body: CreateExpenseDto, @Req() req) {
    return this.financeService.createExpense(body, req.user);
  }

  @Post('expenses/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.ADMIN)
  async approveExpense(@Param('id') id: string, @Body() body: { decision: string; comment?: string }, @Req() req) {
    return this.financeService.approveExpense(id, body?.decision, body?.comment, req.user);
  }

  @Post('expenses/:id/edit-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestExpenseEdit(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.editExpense(id, body, req.user);
  }

  @Post('expenses/:id/delete-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestExpenseDelete(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.deleteExpense(id, body, req.user);
  }

  // === Budgets ===
  @Get('budgets')
  @Roles(...VIEWERS_AND_DEPT)
  async getBudgets(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllBudgets(req.user, query));
  }

  @Post('budgets')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async createBudget(@Body() body: CreateBudgetDto, @Req() req) {
    return this.financeService.createBudget(body, req.user);
  }

  @Post('budgets/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.ADMIN)
  async approveBudget(@Param('id') id: string, @Body() body: { decision: string; comment?: string }, @Req() req) {
    return this.financeService.approveBudget(id, body?.decision, body?.comment, req.user);
  }

  @Post('budgets/:id/edit-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestBudgetEdit(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.editBudget(id, body, req.user);
  }

  @Post('budgets/:id/delete-request')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN)
  async requestBudgetDelete(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.financeService.deleteBudget(id, body, req.user);
  }

  // === Money Requests ===
  @Get('money-requests')
  @Roles(...VIEWERS_AND_DEPT)
  async getMoneyRequests(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllMoneyRequests(req.user, query));
  }

  @Post('money-requests')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.ADMIN)
  async createMoneyRequest(@Body() body: CreateMoneyRequestDto, @Req() req) {
    return this.financeService.createMoneyRequest(body, req.user);
  }

  @Post('money-requests/:id/approve')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.TREASURER, ROLES.ADMIN)
  async approveMoneyRequest(@Param('id') id: string, @Body() body: { decision: string; comment?: string }, @Req() req) {
    return this.financeService.approveMoneyRequest(id, body?.decision, body?.comment, req.user);
  }

  @Post('money-requests/:id/resubmit')
  @Roles(ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.ADMIN)
  async resubmitMoneyRequest(@Param('id') id: string, @Req() req) {
    return this.financeService.resubmitMoneyRequest(id, req.user);
  }

  @Post('money-requests/:id/release')
  @Roles(ROLES.TREASURER)
  async releaseMoneyRequest(@Param('id') id: string, @Body() body: ReleaseMoneyRequestDto, @Req() req) {
    return this.releaseService.release(id, body, req.user);
  }
}
