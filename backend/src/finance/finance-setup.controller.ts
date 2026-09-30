import { Controller, Get, Post, Put, Body, Param, Query, Req } from '@nestjs/common';
import { FinanceCatalogService, CategoryDto, CampaignDto, PeriodDto } from './finance-catalog.service';
import { FinancePledgesService, PledgeDto } from './finance-pledges.service';
import { FinanceReportsService } from './finance-reports.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

const VIEWERS = [ROLES.ADMIN, ROLES.TREASURER, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON];
const MANAGERS = [ROLES.TREASURER, ROLES.SECRETARY, ROLES.ADMIN];
const EVERY_ROLE = [
  ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.TREASURER,
  ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.GENDER_LEADER, ROLES.ORDINARY_MEMBER,
];

// Phase 15 setup/reporting endpoints. @Roles is a coarse gate only; each service enforces the specific
// finance.* permission and tenant scope.
@RequiresModule('finance')
@Controller('finance')
export class FinanceSetupController {
  constructor(
    private readonly catalog: FinanceCatalogService,
    private readonly pledges: FinancePledgesService,
    private readonly reports: FinanceReportsService,
  ) {}

  // === Categories ===
  @Get('categories')
  @Roles(...VIEWERS)
  listCategories(@Req() req, @Query() q: { kind?: string; fellowshipId?: string }) { return this.catalog.listCategories(req.user, q); }

  @Post('categories')
  @Roles(...MANAGERS)
  createCategory(@Body() body: CategoryDto, @Req() req) { return this.catalog.createCategory(body, req.user); }

  @Put('categories/:id')
  @Roles(...MANAGERS)
  updateCategory(@Param('id') id: string, @Body() body: CategoryDto, @Req() req) { return this.catalog.updateCategory(id, body, req.user); }

  // === Campaigns ===
  @Get('campaigns')
  @Roles(...VIEWERS)
  listCampaigns(@Req() req, @Query() q: { status?: string; fellowshipId?: string }) { return this.catalog.listCampaigns(req.user, q); }

  @Get('campaigns/:id')
  @Roles(...VIEWERS)
  getCampaign(@Param('id') id: string, @Req() req) { return this.catalog.getCampaign(id, req.user); }

  @Post('campaigns')
  @Roles(...MANAGERS)
  createCampaign(@Body() body: CampaignDto, @Req() req) { return this.catalog.createCampaign(body, req.user); }

  @Put('campaigns/:id')
  @Roles(...MANAGERS)
  updateCampaign(@Param('id') id: string, @Body() body: CampaignDto, @Req() req) { return this.catalog.updateCampaign(id, body, req.user); }

  // === Financial periods ===
  @Get('periods')
  @Roles(...VIEWERS)
  listPeriods(@Req() req, @Query() q: { fellowshipId?: string }) { return this.catalog.listPeriods(req.user, q); }

  @Post('periods')
  @Roles(...MANAGERS)
  createPeriod(@Body() body: PeriodDto, @Req() req) { return this.catalog.createPeriod(body, req.user); }

  @Post('periods/:id/close')
  @Roles(...MANAGERS)
  closePeriod(@Param('id') id: string, @Req() req) { return this.catalog.closePeriod(id, req.user); }

  @Post('periods/:id/reopen')
  @Roles(ROLES.SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  reopenPeriod(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req) { return this.catalog.reopenPeriod(id, body, req.user); }

  // === Pledges (recurring commitments; never auto-record money) ===
  @Get('pledges')
  @Roles(...VIEWERS)
  listPledges(@Req() req, @Query() q: Record<string, string>) { return this.pledges.list(req.user, q); }

  @Get('pledges/:id/fulfillment')
  @Roles(...VIEWERS)
  pledgeFulfillment(@Param('id') id: string, @Req() req, @Query('asOf') asOf?: string) { return this.pledges.fulfillment(id, req.user, asOf); }

  @Post('pledges')
  @Roles(...MANAGERS)
  createPledge(@Body() body: PledgeDto, @Req() req) { return this.pledges.create(body, req.user); }

  @Put('pledges/:id')
  @Roles(...MANAGERS)
  updatePledge(@Param('id') id: string, @Body() body: PledgeDto, @Req() req) { return this.pledges.update(id, body, req.user); }

  // === Reports / statements ===
  @Get('reports/summary')
  @Roles(...VIEWERS, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  summary(@Req() req, @Query() q: { from?: string; to?: string; departmentId?: string; fellowshipId?: string }) { return this.reports.summary(req.user, q); }

  @Get('members/:id/statement')
  @Roles(...VIEWERS)
  memberStatement(@Param('id') id: string, @Req() req, @Query() q: { from?: string; to?: string }) { return this.reports.memberStatement(id, req.user, q); }

  @Get('my-contributions')
  @Roles(...EVERY_ROLE)
  myContributions(@Req() req, @Query() q: { from?: string; to?: string }) { return this.reports.myContributions(req.user, q); }
}
