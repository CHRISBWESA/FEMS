import { Controller, Get, Post, Put, Body, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { VolunteerRolesService, ServiceRoleDto } from './volunteer-roles.service';
import { VolunteerOpportunitiesService } from './volunteer-opportunities.service';
import { VolunteerAssignmentsService } from './volunteer-assignments.service';
import { VolunteerReportsService } from './volunteer-reports.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

// Volunteering is open to every signed-in role (members apply for themselves, a member can be an opportunity's
// coordinator). @Roles is therefore only a coarse gate; every service method enforces the volunteer.* permission,
// coordinator/department scope and tenant scope.
const EVERY_ROLE = [
  ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.TREASURER, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON, ROLES.GENDER_LEADER, ROLES.ORDINARY_MEMBER,
];

@RequiresModule('volunteers')
@Controller('volunteers')
@Roles(...EVERY_ROLE)
export class VolunteersController {
  constructor(
    private readonly roles: VolunteerRolesService,
    private readonly opportunities: VolunteerOpportunitiesService,
    private readonly assignments: VolunteerAssignmentsService,
    private readonly reports: VolunteerReportsService,
  ) {}

  // ---- roles ----
  @Get('roles')
  listRoles(@Req() req, @Query('fellowshipId') f?: string) { return this.roles.list(req.user, f); }
  @Post('roles')
  createRole(@Body() b: ServiceRoleDto, @Req() req) { return this.roles.create(b, req.user); }
  @Put('roles/:id')
  updateRole(@Param('id') id: string, @Body() b: ServiceRoleDto, @Req() req) { return this.roles.update(id, b, req.user); }

  // ---- opportunities ----
  @Get('opportunities')
  async listOpportunities(@Req() req, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const r = await this.opportunities.list(req.user, q);
    res.setHeader('X-Total-Count', String(r.total));
    return r.data;
  }
  @Post('opportunities')
  createOpportunity(@Body() b: any, @Req() req) { return this.opportunities.create(b, req.user); }
  @Get('opportunities/:id')
  getOpportunity(@Param('id') id: string, @Req() req) { return this.opportunities.get(id, req.user); }
  @Put('opportunities/:id')
  updateOpportunity(@Param('id') id: string, @Body() b: any, @Req() req) { return this.opportunities.update(id, b, req.user); }
  @Post('opportunities/:id/status')
  setStatus(@Param('id') id: string, @Body() b: any, @Req() req) { return this.opportunities.setStatus(id, b, req.user); }
  @Post('opportunities/:id/shifts')
  createShift(@Param('id') id: string, @Body() b: any, @Req() req) { return this.opportunities.createShift(id, b, req.user); }

  // ---- shifts ----
  @Put('shifts/:id')
  updateShift(@Param('id') id: string, @Body() b: any, @Req() req) { return this.opportunities.updateShift(id, b, req.user); }
  @Post('shifts/:id/cancel')
  cancelShift(@Param('id') id: string, @Req() req) { return this.opportunities.cancelShift(id, req.user); }
  @Get('shifts/:id/assignments')
  roster(@Param('id') id: string, @Req() req) { return this.assignments.roster(id, req.user); }
  @Get('shifts/:id/suggestions')
  suggestions(@Param('id') id: string, @Req() req) { return this.assignments.suggestions(id, req.user); }
  @Post('shifts/:id/apply')
  apply(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assignments.apply(id, b, req.user); }
  @Post('shifts/:id/assign')
  assign(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assignments.assign(id, b, req.user); }

  // ---- assignments ----
  @Post('assignments/:id/decide')
  decide(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assignments.decide(id, b, req.user); }
  @Post('assignments/:id/withdraw')
  withdraw(@Param('id') id: string, @Req() req) { return this.assignments.withdraw(id, req.user); }
  @Post('assignments/:id/cancel')
  cancel(@Param('id') id: string, @Req() req) { return this.assignments.cancel(id, req.user); }
  @Post('assignments/:id/attendance')
  attendance(@Param('id') id: string, @Body() b: any, @Req() req) { return this.assignments.markAttendance(id, b, req.user); }

  // ---- history / reports ----
  @Get('my-service')
  myService(@Req() req) { return this.reports.mine(req.user); }
  @Get('members/:memberId/history')
  memberHistory(@Param('memberId') id: string, @Req() req) { return this.reports.memberHistory(id, req.user); }
  @Get('reports/summary')
  summary(@Req() req, @Query() q: Record<string, string>) { return this.reports.summary(req.user, q); }
  @Post('reminders/run')
  runReminders(@Req() req) { return this.reports.runReminders(req.user); }
}
