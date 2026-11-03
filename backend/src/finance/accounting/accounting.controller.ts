import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DepartmentUploadsService, MAX_UPLOAD_BYTES } from '../../department-workspace/department-uploads.service';
import { FinanceScopeService } from './finance-scope.service';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../shared/decorators/role.decorators';
import { RequiresModule } from '../../shared/decorators/platform.decorators';
import { ROLES } from '../../shared/authorization/roles';
import { AccountsService } from './accounts.service';
import { ContributionsCoreService } from './contributions-core.service';
import { ExpensesFlowService } from './expenses-flow.service';
import { FeesService } from './fees.service';
import { DrivesService } from './drives.service';
import { StatementsService } from './statements.service';
import { FinanceApprovalsService } from './finance-approvals.service';
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
 * Finance API. @Roles is only a coarse gate; every service checks the exact office, the department the
 * caller leads (from the database, per request) and the fellowship.
 */
@RequiresModule('finance')
@Controller('finance')
export class AccountingController {
  constructor(
    private accounts: AccountsService,
    private contributions: ContributionsCoreService,
    private expenses: ExpensesFlowService,
    private fees: FeesService,
    private drives: DrivesService,
    private statements: StatementsService,
    private approvals: FinanceApprovalsService,
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

  // ---- dashboard and settings ----
  @Get('dashboard') @Roles(...ALL) dashboard(@Req() req, @Query() q) { return this.statements.dashboard(req.user, q); }
  @Get('settings') @Roles(...ALL) settings(@Req() req) { return this.accounts.getSettings(req.user); }
  @Put('settings') @Roles(ROLES.TREASURER) updateSettings(@Req() req, @Body() b) { return this.accounts.updateSettings(req.user, b); }

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
  @Post('contributions/:id/reverse') @Roles(ROLES.DEPARTMENT_CHAIRPERSON) reverse(@Req() req, @Param('id') id: string, @Body() b) { return this.contributions.reverseDepartment(req.user, id, b); }

  // ---- expenses (recording is POST /finance/expenses) ----
  @Get('expenses/:id') @Roles(...ALL) expense(@Req() req, @Param('id') id: string) { return this.expenses.detail(req.user, id); }
  @Post('expenses/:id/verify') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) verify(@Req() req, @Param('id') id: string) { return this.expenses.verify(req.user, id); }
  @Post('expenses/:id/pay') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) pay(@Req() req, @Param('id') id: string, @Body() b) { return this.expenses.pay(req.user, id, b); }
  @Post('expenses/:id/cancel') @Roles(...ALL) cancelExpense(@Req() req, @Param('id') id: string, @Body() b) { return this.expenses.cancel(req.user, id, b); }

  // ---- department membership fees and transparency summary ----
  @Get('departments/:deptId/fees') @Roles(...ALL) listFees(@Req() req, @Param('deptId') d: string) { return this.fees.list(req.user, d); }
  @Post('departments/:deptId/fees') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) createFee(@Req() req, @Param('deptId') d: string, @Body() b) { return this.fees.create(req.user, d, b); }
  @Put('departments/:deptId/fees/:id') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) updateFee(@Req() req, @Param('deptId') d: string, @Param('id') id: string, @Body() b) { return this.fees.update(req.user, d, id, b); }
  @Get('departments/:deptId/fees/:id/status') @Roles(...ALL) feeStatus(@Req() req, @Param('deptId') d: string, @Param('id') id: string) { return this.fees.status(req.user, d, id); }
  @Post('departments/:deptId/fees/:id/payments') @Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) feePayment(@Req() req, @Param('deptId') d: string, @Param('id') id: string, @Body() b) { return this.fees.recordPayment(req.user, d, id, b); }
  @Get('departments/:deptId/summary') @Roles(...ALL)
  async deptSummary(@Req() req, @Param('deptId') d: string, @Query() q, @Res() res: Response) { return sendReport(res, await this.statements.departmentSummary(req.user, d, q), q?.format); }

  // ---- contribution drives: pledges and cash per contributor, target and expenses ----
  @Get('drives') @Roles(...ALL) listDrives(@Req() req, @Query() q) { return this.drives.list(req.user, q); }
  @Post('drives') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) createDrive(@Req() req, @Body() b) { return this.drives.create(req.user, b); }
  @Get('drives/:id') @Roles(...ALL) drive(@Req() req, @Param('id') id: string) { return this.drives.detail(req.user, id); }
  @Put('drives/:id') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) updateDrive(@Req() req, @Param('id') id: string, @Body() b) { return this.drives.update(req.user, id, b); }
  @Get('drives/:id/contributors/:key') @Roles(...ALL) driveContributor(@Req() req, @Param('id') id: string, @Param('key') key: string) { return this.drives.contributor(req.user, id, key); }
  @Post('drives/:id/pledges') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) drivePledge(@Req() req, @Param('id') id: string, @Body() b) { return this.drives.addPledge(req.user, id, b); }
  @Post('drives/:id/payments') @Roles(ROLES.TREASURER, ROLES.SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY) driveCash(@Req() req, @Param('id') id: string, @Body() b) { return this.drives.addCash(req.user, id, b); }

  // ---- approvals inbox ----
  @Get('approvals') @Roles(...ALL) inbox(@Req() req) { return this.approvals.inbox(req.user); }
  @Post('approvals/:id/decide') @Roles(...ALL) decide(@Req() req, @Param('id') id: string, @Body() b) { return this.approvals.decide(req.user, id, b); }
  @Get('approvals/:id/history') @Roles(...ALL) history(@Req() req, @Param('id') id: string) { return this.approvals.history(req.user, id); }

  // ---- reports ----
  @Get('statements') @Roles(...ALL) reports(@Req() req) { return this.statements.list(req.user); }
  @Get('statements/:key') @Roles(...ALL)
  async report(@Req() req, @Param('key') key: string, @Query() q, @Res() res: Response) { return sendReport(res, await this.statements.build(req.user, key, q), q?.format); }

  // ---- lookups for forms ----
  @Get('member-search') @Roles(...CENTRAL) memberSearch(@Req() req, @Query() q) { return this.drives.memberSearch(req.user, q); }
}
