import { Controller, Get, Query, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

// Coarse gate only: every section re-checks the same permission its source module uses, and applies the same
// tenant / department scope. Analytics never has a wider view of the data than the module it summarises.
const VIEWERS = [
  ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.TREASURER, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON,
];

@RequiresModule('analytics')
@Controller('analytics')
@Roles(...VIEWERS)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Req() req, @Query() q: Record<string, string>) { return this.analytics.overview(req.user, q); }
  @Get('membership')
  membership(@Req() req, @Query() q: Record<string, string>) { return this.analytics.membership(req.user, q); }
  @Get('participation')
  participation(@Req() req, @Query() q: Record<string, string>) { return this.analytics.participation(req.user, q); }
  @Get('finance')
  finance(@Req() req, @Query() q: Record<string, string>) { return this.analytics.finance(req.user, q); }
  @Get('youth')
  youth(@Req() req, @Query() q: Record<string, string>) { return this.analytics.youthSection(req.user, q); }
  @Get('resources')
  resources(@Req() req, @Query() q: Record<string, string>) { return this.analytics.resources(req.user, q); }
  @Get('volunteers')
  volunteers(@Req() req, @Query() q: Record<string, string>) { return this.analytics.volunteers(req.user, q); }
}
