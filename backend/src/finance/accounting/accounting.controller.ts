import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DepartmentUploadsService, MAX_UPLOAD_BYTES } from '../../department-workspace/department-uploads.service';
import { FinanceScopeService } from './finance-scope.service';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../shared/decorators/role.decorators';
import { Public } from '../../shared/decorators/public.decorator';
import { RequiresModule } from '../../shared/decorators/platform.decorators';
import { ROLES } from '../../shared/authorization/roles';
import { PUBLIC_THROTTLE } from '../../shared/throttle';
import { AccountsService } from './accounts.service';
import { ContributionsCoreService } from './contributions-core.service';
import { ExpensesFlowService } from './expenses-flow.service';
import { BudgetsService } from './budgets.service';
import { FeesService } from './fees.service';
import { ProjectsService } from './projects.service';
import { FundraisingService } from './fundraising.service';
import { StatementsService } from './statements.service';
import { FinanceApprovalsService } from './finance-approvals.service';
import { FinanceRemindersService } from './finance-reminders.service';
import { FinancePledgesService } from '../finance-pledges.service';
import { receiptToPdf, Report, reportToPdf, reportToXlsx } from './exporters';

const CENTRAL = [ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON];
const ALL = [...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY];

/** Sends a report as JSON, an Excel workbook or a PDF. */
async function sendReport(res: Response, report: Report, format?: string) {
  const name = `${report.key}-${report.generatedAt.toISOString().slice(0, 10)}`;
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return res.send(await reportToXlsx(report));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    return res.send(await reportToPdf(report));
  }
  return res.json(report);
}

/**
 * Finance & projects API. @Roles is only a coarse gate; every service checks the exact office, the department the
 * caller leads (from the database, per request) and the fellowship.
 */
@RequiresModule('finance')
@Controller('finance')
export class AccountingController {
  constructor(
    private accounts: AccountsService,
    private contributions: ContributionsCoreService,
    private expenses: ExpensesFlowService,
    private budgets: BudgetsService,
    private fees: FeesService,
    private projects: ProjectsService,
    private fundraising: FundraisingService,
    private statements: StatementsService,
    private approvals: FinanceApprovalsService,
    private reminders: FinanceRemindersService,
    private pledges: FinancePledgesService,
    private uploads: DepartmentUploadsService,
    private scope: FinanceScopeService,
  ) {}

  // ---- supporting documents (receipts, invoices, evidence) for central or department records ----
  @Post('uploads') @Roles(...ALL) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  async upload(@Req() req, @Query('departmentId') departmentId: string, @UploadedFile() file: Express.Multer.File) {
    const dept = departmentId && departmentId !== 'central' ? departmentId : null;
    await this.scope.requireManage(req.user, dept, { central: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson'] });
    return this.uploads.upload(req.user, { id: dept ?? 'central', fellowship_id: req.user.fellowshipId }, file);
  }

  // ---- dashboard, settings, general fund ----
  @Get('dashboard') @Roles(...ALL) dashboard(@Req() req, @Query() q) { return this.statements.dashboard(req.user, q); }
  @Get('settings') @Roles(...ALL) settings(@Req() req) { return this.accounts.getSettings(req.user); }
  @Put('settings') @Roles(ROLES.TREASURER) updateSettings(@Req() req, @Body() b) { return this.accounts.updateSettings(req.user, b); }
  @Get('general-fund') @Roles(...CENTRAL) generalFund(@Req() req, @Query() q) { return this.accounts.generalFund(req.user, q); }

  // ---- accounts and ledger ----
  @Get('accounts') @Roles(...ALL) listAccounts(@Req() req, @Query() q) { return this.accounts.list(req.user, q); }
  @Post('accounts') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) createAccount(@Req() req, @Body() b) { return this.accounts.create(req.user, b); }
  @Get('accounts/:id') @Roles(...ALL) getAccount(@Req() req, @Param('id') id: string) { return this.accounts.get(req.user, id); }
  @Put('accounts/:id') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) updateAccount(@Req() req, @Param('id') id: string, @Body() b) { return this.accounts.update(req.user, id, b); }
  @Get('accounts/:id/entries') @Roles(...ALL) entries(@Req() req, @Param('id') id: string, @Query() q) { return this.accounts.entries(req.user, id, q); }
  @Post('accounts/:id/reconcile') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) reconcile(@Req() req, @Param('id') id: string, @Body() b) { return this.accounts.reconcile(req.user, id, b); }
  @Get('accounts/:id/reconciliations') @Roles(...ALL) reconciliations(@Req() req, @Param('id') id: string) { return this.accounts.reconciliations(req.user, id); }
  @Get('ledger') @Roles(...ALL) ledger(@Req() req, @Query() q) { return this.accounts.ledger(req.user, q); }

  // ---- transfers ----
  @Get('transfers') @Roles(...ALL) transfers(@Req() req, @Query() q) { return this.accounts.listTransfers(req.user, q); }
  @Post('transfers') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) transfer(@Req() req, @Body() b) { return this.accounts.createTransfer(req.user, b); }
  @Get('transfers/:id') @Roles(...ALL) getTransfer(@Req() req, @Param('id') id: string) { return this.accounts.getTransfer(req.user, id); }
  @Post('transfers/:id/cancel') @Roles(...ALL) cancelTransfer(@Req() req, @Param('id') id: string) { return this.accounts.cancelTransfer(req.user, id); }

  // ---- contributions (recording is POST /finance/contributions) ----
  @Get('contributions/:id') @Roles(...ALL) contribution(@Req() req, @Param('id') id: string) { return this.contributions.detail(req.user, id); }
  @Get('contributions/:id/receipt') @Roles(...ALL)
  async receipt(@Req() req, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const r = await this.contributions.receipt(req.user, id);
    if (format !== 'pdf') return res.json(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${r.receiptNumber}.pdf"`);
    return res.send(await receiptToPdf(r));
  }
  @Put('contributions/:id/allocations') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) allocate(@Req() req, @Param('id') id: string, @Body() b) { return this.contributions.setAllocations(req.user, id, b); }
  @Post('contributions/:id/reverse') @Roles(ROLES.DEPARTMENT_CHAIRPERSON) reverse(@Req() req, @Param('id') id: string, @Body() b) { return this.contributions.reverseDepartment(req.user, id, b); }

  // ---- expenses (recording is POST /finance/expenses) ----
  @Get('expenses/:id') @Roles(...ALL) expense(@Req() req, @Param('id') id: string) { return this.expenses.detail(req.user, id); }
  @Post('expenses/:id/verify') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) verify(@Req() req, @Param('id') id: string) { return this.expenses.verify(req.user, id); }
  @Post('expenses/:id/pay') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) pay(@Req() req, @Param('id') id: string, @Body() b) { return this.expenses.pay(req.user, id, b); }
  @Post('expenses/:id/cancel') @Roles(...ALL) cancelExpense(@Req() req, @Param('id') id: string, @Body() b) { return this.expenses.cancel(req.user, id, b); }

  // ---- budgets ----
  @Get('budgets/chargeable') @Roles(...ALL) chargeable(@Req() req, @Query() q) { return this.budgets.chargeable(req.user, q); }
  @Get('budgets/:id') @Roles(...ALL) budget(@Req() req, @Param('id') id: string) { return this.budgets.detail(req.user, id); }
  @Post('budgets/:id/revisions') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) revise(@Req() req, @Param('id') id: string, @Body() b) { return this.budgets.proposeRevision(req.user, id, b); }
  @Get('budget-calls') @Roles(...ALL) calls(@Req() req) { return this.budgets.listCalls(req.user); }
  @Post('budget-calls') @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY) createCall(@Req() req, @Body() b) { return this.budgets.createCall(req.user, b); }
  @Get('budget-calls/:id/status') @Roles(...CENTRAL) callStatus(@Req() req, @Param('id') id: string) { return this.budgets.callStatus(req.user, id); }
  @Post('budget-calls/:id/close') @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY) closeCall(@Req() req, @Param('id') id: string) { return this.budgets.closeCall(req.user, id); }

  // ---- pledges (beyond the original list/create) ----
  @Get('pledges/:id') @Roles(...ALL) pledge(@Req() req, @Param('id') id: string) { return this.pledges.getPledge(id, req.user); }
  @Post('pledges/:id/payments') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) payPledge(@Req() req, @Param('id') id: string, @Body() b) { return this.pledges.payPledge(id, b, req.user); }
  @Post('pledges/:id/cancel') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON) cancelPledge(@Req() req, @Param('id') id: string, @Body() b) { return this.pledges.cancelPledge(id, b, req.user); }

  // ---- department membership fees and transparency summary ----
  @Get('departments/:deptId/fees') @Roles(...ALL) listFees(@Req() req, @Param('deptId') d: string) { return this.fees.list(req.user, d); }
  @Post('departments/:deptId/fees') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) createFee(@Req() req, @Param('deptId') d: string, @Body() b) { return this.fees.create(req.user, d, b); }
  @Put('departments/:deptId/fees/:id') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) updateFee(@Req() req, @Param('deptId') d: string, @Param('id') id: string, @Body() b) { return this.fees.update(req.user, d, id, b); }
  @Get('departments/:deptId/fees/:id/status') @Roles(...ALL) feeStatus(@Req() req, @Param('deptId') d: string, @Param('id') id: string) { return this.fees.status(req.user, d, id); }
  @Post('departments/:deptId/fees/:id/payments') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) feePayment(@Req() req, @Param('deptId') d: string, @Param('id') id: string, @Body() b) { return this.fees.recordPayment(req.user, d, id, b); }
  @Get('departments/:deptId/summary') @Roles(...ALL)
  async deptSummary(@Req() req, @Param('deptId') d: string, @Query() q, @Res() res: Response) { return sendReport(res, await this.statements.departmentSummary(req.user, d, q), q?.format); }

  // ---- campaigns: public pages and updates ----
  @Post('campaigns/:id/publish') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON) publish(@Req() req, @Param('id') id: string) { return this.fundraising.publish(req.user, id); }
  @Post('campaigns/:id/unpublish') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON) unpublish(@Req() req, @Param('id') id: string) { return this.fundraising.unpublish(req.user, id); }
  @Get('campaigns/:id/qr') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async qr(@Req() req, @Param('id') id: string, @Res() res: Response) { res.setHeader('Content-Type', 'image/svg+xml'); return res.send(await this.fundraising.qr(req.user, id)); }
  @Get('campaigns/:id/updates') @Roles(...ALL) updates(@Req() req, @Param('id') id: string) { return this.fundraising.updates(req.user, id); }
  @Post('campaigns/:id/updates') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON) addUpdate(@Req() req, @Param('id') id: string, @Body() b) { return this.fundraising.addUpdate(req.user, id, b); }
  @Put('campaigns/:id/updates/:updateId') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON) updateVisibility(@Req() req, @Param('id') id: string, @Param('updateId') u: string, @Body() b) { return this.fundraising.setUpdateVisibility(req.user, id, u, b); }

  // ---- approvals inbox ----
  @Get('approvals') @Roles(...ALL) inbox(@Req() req) { return this.approvals.inbox(req.user); }
  @Post('approvals/:id/decide') @Roles(...ALL) decide(@Req() req, @Param('id') id: string, @Body() b) { return this.approvals.decide(req.user, id, b); }
  @Get('approvals/:id/history') @Roles(...ALL) history(@Req() req, @Param('id') id: string) { return this.approvals.history(req.user, id); }

  // ---- reports and reminders ----
  @Get('statements') @Roles(...ALL) reports(@Req() req) { return this.statements.list(req.user); }
  @Get('statements/:key') @Roles(...ALL)
  async report(@Req() req, @Param('key') key: string, @Query() q, @Res() res: Response) { return sendReport(res, await this.statements.build(req.user, key, q), q?.format); }
  @Post('reminders/run') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY) runReminders(@Req() req) { return this.reminders.run(req.user); }

  // ---- lookups for forms ----
  @Get('fundable-projects') @Roles(...ALL) fundable(@Req() req, @Query() q) { return this.projects.fundable(req.user, q); }
}

@RequiresModule('finance')
@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get() @Roles(...ALL) list(@Req() req, @Query() q) { return this.projects.list(req.user, q); }
  @Post() @Roles(...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON) create(@Req() req, @Body() b) { return this.projects.create(req.user, b); }
  @Get(':id') @Roles(...ALL) get(@Req() req, @Param('id') id: string) { return this.projects.detail(req.user, id); }
  @Put(':id') @Roles(...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON) update(@Req() req, @Param('id') id: string, @Body() b) { return this.projects.update(req.user, id, b); }
  @Post(':id/submit') @Roles(...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON) submit(@Req() req, @Param('id') id: string) { return this.projects.submit(req.user, id); }
  @Post(':id/status') @Roles(...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON) status(@Req() req, @Param('id') id: string, @Body() b) { return this.projects.setStatus(req.user, id, b); }
  @Post(':id/allocations') @Roles(ROLES.TREASURER) allocate(@Req() req, @Param('id') id: string, @Body() b) { return this.projects.requestAllocation(req.user, id, b); }
  @Post(':id/closure') @Roles(...CENTRAL, ROLES.DEPARTMENT_CHAIRPERSON) closure(@Req() req, @Param('id') id: string, @Body() b) { return this.projects.requestClosure(req.user, id, b); }
}

/** The public fundraising page: no sign-in, aggregates only, rate limited. */
@Controller('public/fundraising')
export class PublicFundraisingController {
  constructor(private fundraising: FundraisingService) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':slug')
  page(@Param('slug') slug: string) { return this.fundraising.publicPage(slug); }
}
