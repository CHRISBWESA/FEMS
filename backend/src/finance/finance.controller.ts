import { Controller, Get, Post, Body, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  FinanceService,
  CreateContributionDto,
  CreateExpenseDto,
  ListQuery,
} from './finance.service';
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
  ) {}

  // === Contributions ===
  @Get('contributions')
  @Roles(...VIEWERS_AND_DEPT)
  async getContributions(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllContributions(req.user, query));
  }

  @Post('contributions')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
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

  // === Expenses ===
  @Get('expenses')
  @Roles(...VIEWERS_AND_DEPT)
  async getExpenses(@Req() req, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    return withTotal(res, await this.financeService.findAllExpenses(req.user, query));
  }

  @Post('expenses')
  @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
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
}
