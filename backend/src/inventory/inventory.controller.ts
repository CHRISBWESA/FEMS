import { Body, Controller, Get, Module, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../shared/decorators/role.decorators';
import { RequiresModule } from '../shared/decorators/platform.decorators';
import { ROLES } from '../shared/authorization/roles';
import { StorageModule } from '../shared/storage/storage.module';
import { FinanceModule } from '../finance/finance.module';
import { DepartmentUploadsService, MAX_UPLOAD_BYTES } from '../department-workspace/department-uploads.service';
import { reportToPdf, reportToXlsx } from '../finance/accounting/exporters';
import { InventoryScopeService } from './inventory-scope.service';
import { InventoryAssetsService } from './inventory-assets.service';
import { InventoryFlowsService } from './inventory-flows.service';
import { InventoryCareService } from './inventory-care.service';
import { InventoryReportsService } from './inventory-reports.service';

const ALL = [ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY];
const MANAGERS = [ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY];
const CENTRAL = [ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON];

/**
 * Resource management API. @Roles is a coarse gate only: every operation checks ownership and the department the
 * caller currently leads, on the server, per request.
 */
@RequiresModule('resources')
@Controller('inventory')
export class InventoryController {
  constructor(
    private scope: InventoryScopeService,
    private assets: InventoryAssetsService,
    private flows: InventoryFlowsService,
    private care: InventoryCareService,
    private reports: InventoryReportsService,
    private uploads: DepartmentUploadsService,
  ) {}

  @Get('dashboard') @Roles(...ALL) dashboard(@Req() req, @Query() q) { return this.reports.dashboard(req.user, q); }
  @Get('settings') @Roles(...ALL) settings(@Req() req) { return this.assets.getSettings(req.user); }
  @Put('settings') @Roles(ROLES.TREASURER) saveSettings(@Req() req, @Body() b) { return this.assets.updateSettings(req.user, b); }

  @Get('categories') @Roles(...ALL) categories(@Req() req) { return this.assets.categories(req.user, 'category'); }
  @Post('categories') @Roles(ROLES.TREASURER) addCategory(@Req() req, @Body() b) { return this.assets.saveCategory(req.user, 'category', b); }
  @Post('categories/defaults') @Roles(ROLES.TREASURER) defaults(@Req() req) { return this.assets.addDefaultCategories(req.user); }
  @Put('categories/:id') @Roles(ROLES.TREASURER) editCategory(@Req() req, @Param('id') id: string, @Body() b) { return this.assets.saveCategory(req.user, 'category', b, id); }
  @Get('locations') @Roles(...ALL) locations(@Req() req) { return this.assets.categories(req.user, 'location'); }
  @Post('locations') @Roles(ROLES.TREASURER) addLocation(@Req() req, @Body() b) { return this.assets.saveCategory(req.user, 'location', b); }
  @Put('locations/:id') @Roles(ROLES.TREASURER) editLocation(@Req() req, @Param('id') id: string, @Body() b) { return this.assets.saveCategory(req.user, 'location', b, id); }

  @Post('uploads') @Roles(...MANAGERS) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  async upload(@Req() req, @Query('departmentId') departmentId: string, @UploadedFile() file: Express.Multer.File) {
    const dept = departmentId && departmentId !== 'central' ? departmentId : null;
    await this.scope.requireManageScope(req.user, dept);
    return this.uploads.upload(req.user, { id: dept ?? 'resources', fellowship_id: req.user.fellowshipId }, file);
  }

  // ---- register ----
  @Get('assets') @Roles(...ALL) list(@Req() req, @Query() q) { return this.assets.list(req.user, q); }
  @Post('assets') @Roles(...MANAGERS) register(@Req() req, @Body() b) { return this.assets.register(req.user, b); }
  @Get('assets/:id') @Roles(...ALL) detail(@Req() req, @Param('id') id: string) { return this.assets.detail(req.user, id); }
  @Put('assets/:id') @Roles(...MANAGERS) update(@Req() req, @Param('id') id: string, @Body() b) { return this.assets.update(req.user, id, b); }
  @Post('assets/:id/inspect') @Roles(...MANAGERS) inspect(@Req() req, @Param('id') id: string, @Body() b) { return this.assets.inspect(req.user, id, b); }
  @Post('assets/:id/return-to-owner') @Roles(...MANAGERS) returnToOwner(@Req() req, @Param('id') id: string, @Body() b) { return this.assets.returnToOwner(req.user, id, b); }
  @Get('assets/:id/label') @Roles(...ALL)
  async label(@Req() req, @Param('id') id: string, @Res() res: Response) { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="label.pdf"'); return res.send(await this.assets.label(req.user, id)); }

  // ---- custody and movement ----
  @Post('assets/:id/assign') @Roles(ROLES.TREASURER) assign(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.assign(req.user, id, b); }
  @Post('assets/:id/end-assignment') @Roles(ROLES.TREASURER) endAssignment(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.endAssignment(req.user, id, b); }
  @Post('assets/:id/transfer') @Roles(...MANAGERS) transfer(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.transfer(req.user, id, b); }
  @Get('transfers') @Roles(...ALL) transfers(@Req() req, @Query() q) { return this.flows.listTransfers(req.user, q); }

  // ---- requests, handover, return ----
  @Get('requestable') @Roles(...ALL) requestable(@Req() req, @Query() q) { return this.flows.requestable(req.user, q); }
  @Get('requests') @Roles(...ALL) requests(@Req() req, @Query() q) { return this.flows.listRequests(req.user, q); }
  @Post('requests') @Roles(...ALL) request(@Req() req, @Body() b) { return this.flows.createRequest(req.user, b); }
  @Post('requests/:id/decide') @Roles(ROLES.TREASURER, ROLES.DEPARTMENT_CHAIRPERSON) decide(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.decide(req.user, id, b); }
  @Post('requests/:id/cancel') @Roles(...ALL) cancel(@Req() req, @Param('id') id: string) { return this.flows.cancelRequest(req.user, id); }
  @Post('requests/:id/issue') @Roles(...MANAGERS) issue(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.issue(req.user, id, b); }
  @Post('requests/:id/return') @Roles(...MANAGERS) returnItems(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.returnItems(req.user, id, b); }
  @Post('requests/:id/lost') @Roles(...MANAGERS) lost(@Req() req, @Param('id') id: string, @Body() b) { return this.flows.reportLostOnLoan(req.user, id, b); }

  // ---- maintenance ----
  @Get('maintenance') @Roles(...ALL) maintenance(@Req() req, @Query() q) { return this.care.listMaintenance(req.user, q); }
  @Post('assets/:id/maintenance') @Roles(...ALL) report(@Req() req, @Param('id') id: string, @Body() b) { return this.care.reportMaintenance(req.user, id, b); }
  @Post('maintenance/:id/review') @Roles(...MANAGERS) review(@Req() req, @Param('id') id: string, @Body() b) { return this.care.reviewMaintenance(req.user, id, b); }
  @Post('maintenance/:id/link-expense') @Roles(...MANAGERS) link(@Req() req, @Param('id') id: string, @Body() b) { return this.care.linkExpense(req.user, id, b); }
  @Post('maintenance/:id/start') @Roles(...MANAGERS) start(@Req() req, @Param('id') id: string) { return this.care.startMaintenance(req.user, id); }
  @Post('maintenance/:id/complete') @Roles(...MANAGERS) complete(@Req() req, @Param('id') id: string, @Body() b) { return this.care.completeMaintenance(req.user, id, b); }
  @Post('maintenance/:id/cancel') @Roles(...MANAGERS) cancelMaint(@Req() req, @Param('id') id: string) { return this.care.cancelMaintenance(req.user, id); }

  // ---- loss, damage, disposal ----
  @Get('incidents') @Roles(...ALL) incidents(@Req() req, @Query() q) { return this.care.listIncidents(req.user, q); }
  @Post('assets/:id/incidents') @Roles(...ALL) incident(@Req() req, @Param('id') id: string, @Body() b) { return this.care.reportIncident(req.user, id, b); }
  @Put('incidents/:id') @Roles(...MANAGERS) updateIncident(@Req() req, @Param('id') id: string, @Body() b) { return this.care.updateIncident(req.user, id, b); }
  @Post('incidents/:id/close') @Roles(...MANAGERS) closeIncident(@Req() req, @Param('id') id: string, @Body() b) { return this.care.closeIncident(req.user, id, b); }
  @Post('assets/:id/disposal') @Roles(...MANAGERS) disposal(@Req() req, @Param('id') id: string, @Body() b) { return this.care.requestDisposal(req.user, id, b); }

  // ---- stock ----
  @Post('assets/:id/stock/receive') @Roles(...MANAGERS) receive(@Req() req, @Param('id') id: string, @Body() b) { return this.care.receiveStock(req.user, id, b); }
  @Post('assets/:id/stock/issue') @Roles(...MANAGERS) issueStock(@Req() req, @Param('id') id: string, @Body() b) { return this.care.issueStock(req.user, id, b); }
  @Post('assets/:id/stock/adjust') @Roles(...MANAGERS) adjust(@Req() req, @Param('id') id: string, @Body() b) { return this.care.adjustStock(req.user, id, b); }
  @Post('assets/:id/stock/transfer') @Roles(...MANAGERS) transferStock(@Req() req, @Param('id') id: string, @Body() b) { return this.care.transferStock(req.user, id, b); }
  @Get('assets/:id/stock') @Roles(...ALL) movements(@Req() req, @Param('id') id: string) { return this.care.movements(req.user, id); }

  // ---- reports, reminders ----
  @Get('reports') @Roles(...ALL) reportList(@Req() req) { return this.reports.list(req.user); }
  @Get('reports/:key') @Roles(...ALL)
  async reportOne(@Req() req, @Param('key') key: string, @Query() q, @Res() res: Response) {
    const r = await this.reports.build(req.user, key, q);
    const name = `${r.key}-${r.generatedAt.toISOString().slice(0, 10)}`;
    if (q?.format === 'xlsx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); return res.send(await reportToXlsx(r)); }
    if (q?.format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`); return res.send(await reportToPdf(r)); }
    return res.json(r);
  }
  @Post('reminders/run') @Roles(...CENTRAL) reminders(@Req() req) { return this.care.runReminders(req.user); }
}

@Module({
  imports: [FinanceModule, StorageModule],
  providers: [InventoryScopeService, InventoryAssetsService, InventoryFlowsService, InventoryCareService, InventoryReportsService, DepartmentUploadsService],
  controllers: [InventoryController],
})
export class InventoryModule {}
