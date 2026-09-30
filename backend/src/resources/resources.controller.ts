import { Controller, Get, Post, Put, Body, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssetsService, CreateAssetDto } from './assets.service';
import { AssetLoansService } from './asset-loans.service';
import { AssetMaintenanceService } from './asset-maintenance.service';
import { ResourcesCatalogService, NamedDto } from './resources-catalog.service';
import { ResourcesReportsService } from './resources-reports.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

// @Roles is only a coarse gate; every service method enforces the specific resources.* permission plus
// tenant and department scope.
const VIEWERS = [
  ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.TREASURER, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON,
];
const OPERATORS = [ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY];
const EVERY_ROLE = [...VIEWERS, ROLES.GENDER_LEADER, ROLES.ORDINARY_MEMBER];

@RequiresModule('resources')
@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly assets: AssetsService,
    private readonly loans: AssetLoansService,
    private readonly maintenance: AssetMaintenanceService,
    private readonly catalog: ResourcesCatalogService,
    private readonly reports: ResourcesReportsService,
  ) {}

  // ---- categories / locations ----
  @Get('categories') @Roles(...VIEWERS)
  listCategories(@Req() req, @Query('fellowshipId') f?: string) { return this.catalog.list('category', req.user, f); }
  @Post('categories') @Roles(...OPERATORS)
  createCategory(@Body() b: NamedDto, @Req() req) { return this.catalog.create('category', b, req.user); }
  @Put('categories/:id') @Roles(...OPERATORS)
  updateCategory(@Param('id') id: string, @Body() b: NamedDto, @Req() req) { return this.catalog.update('category', id, b, req.user); }

  @Get('locations') @Roles(...VIEWERS)
  listLocations(@Req() req, @Query('fellowshipId') f?: string) { return this.catalog.list('location', req.user, f); }
  @Post('locations') @Roles(...OPERATORS)
  createLocation(@Body() b: NamedDto, @Req() req) { return this.catalog.create('location', b, req.user); }
  @Put('locations/:id') @Roles(...OPERATORS)
  updateLocation(@Param('id') id: string, @Body() b: NamedDto, @Req() req) { return this.catalog.update('location', id, b, req.user); }

  // ---- assets ----
  @Get('assets') @Roles(...VIEWERS)
  async listAssets(@Req() req, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const r = await this.assets.list(req.user, q);
    res.setHeader('X-Total-Count', String(r.total));
    return r.data;
  }
  @Post('assets') @Roles(...OPERATORS)
  createAsset(@Body() b: CreateAssetDto, @Req() req) { return this.assets.create(b, req.user); }
  @Get('assets/:id') @Roles(...VIEWERS)
  getAsset(@Param('id') id: string, @Req() req) { return this.assets.get(id, req.user); }
  @Put('assets/:id') @Roles(...OPERATORS)
  updateAsset(@Param('id') id: string, @Body() b: Partial<CreateAssetDto>, @Req() req) { return this.assets.update(id, b, req.user); }

  @Post('assets/:id/transfer') @Roles(...OPERATORS)
  transfer(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assets.transfer(id, b, req.user); }
  @Post('assets/:id/retire') @Roles(ROLES.ADMIN, ROLES.SECRETARY)
  retire(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assets.retire(id, b, req.user); }
  @Post('assets/:id/adjust-quantity') @Roles(...OPERATORS)
  adjust(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assets.adjustQuantity(id, b, req.user); }

  @Get('assets/:id/history') @Roles(...VIEWERS)
  history(@Param('id') id: string, @Req() req) { return this.assets.history(id, req.user); }
  @Get('assets/:id/documents') @Roles(...VIEWERS)
  documents(@Param('id') id: string, @Req() req) { return this.assets.listDocuments(id, req.user); }
  @Post('assets/:id/documents') @Roles(...OPERATORS)
  attach(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assets.attachDocument(id, b, req.user); }
  @Post('assets/:id/documents/:linkId/remove') @Roles(...OPERATORS)
  detach(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req) { return this.assets.removeDocument(id, linkId, req.user); }

  // ---- loans ----
  @Post('assets/:id/check-out') @Roles(...VIEWERS)
  checkOut(@Param('id') id: string, @Body() b: any, @Req() req) { return this.loans.checkOut(id, b, req.user); }
  @Post('assets/:id/check-in') @Roles(...VIEWERS)
  checkIn(@Param('id') id: string, @Body() b: any, @Req() req) { return this.loans.checkIn(id, b, req.user); }
  @Get('assets/:id/loans') @Roles(...VIEWERS)
  assetLoans(@Param('id') id: string, @Req() req) { return this.loans.listForAsset(id, req.user); }
  @Get('my-loans') @Roles(...EVERY_ROLE)
  myLoans(@Req() req) { return this.loans.myLoans(req.user); }

  // ---- maintenance ----
  @Get('maintenance') @Roles(...VIEWERS)
  listMaintenance(@Req() req, @Query() q: Record<string, string>) { return this.maintenance.list(req.user, q); }
  @Get('assets/:id/maintenance') @Roles(...VIEWERS)
  assetMaintenance(@Param('id') id: string, @Req() req) { return this.maintenance.listForAsset(id, req.user); }
  @Post('assets/:id/maintenance') @Roles(...OPERATORS)
  schedule(@Param('id') id: string, @Body() b: any, @Req() req) { return this.maintenance.schedule(id, b, req.user); }
  @Post('maintenance/:mid/start') @Roles(...OPERATORS)
  start(@Param('mid') mid: string, @Req() req) { return this.maintenance.start(mid, req.user); }
  @Post('maintenance/:mid/complete') @Roles(...OPERATORS)
  complete(@Param('mid') mid: string, @Body() b: any, @Req() req) { return this.maintenance.complete(mid, b, req.user); }
  @Post('maintenance/:mid/cancel') @Roles(...OPERATORS)
  cancel(@Param('mid') mid: string, @Req() req) { return this.maintenance.cancel(mid, req.user); }

  // ---- reports / reminders ----
  @Get('reports/summary') @Roles(...VIEWERS)
  summary(@Req() req, @Query() q: { from?: string; to?: string; fellowshipId?: string }) { return this.reports.summary(req.user, q); }
  @Post('reminders/run') @Roles(...OPERATORS)
  reminders(@Req() req) { return this.reports.runReminders(req.user); }
}
