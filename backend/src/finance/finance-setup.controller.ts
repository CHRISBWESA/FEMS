import { Controller, Get, Post, Put, Body, Param, Query, Req } from '@nestjs/common';
import { FinanceCatalogService, CategoryDto, PeriodDto } from './finance-catalog.service';
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
