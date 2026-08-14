import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { ReportsService, SubmitReportDto } from './reports.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async findAll(@Req() req) {
    return this.reportsService.findAll(req.user);
  }

  @Get(':id')
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async findOne(@Param('id') id: string, @Req() req) {
    return this.reportsService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async submit(@Body() body: SubmitReportDto, @Req() req) {
    return this.reportsService.submit(body, req.user);
  }

  @Post(':id/review')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async review(
    @Param('id') id: string,
    @Body() body: { decision: 'approved' | 'rejected'; comment?: string },
    @Req() req,
  ) {
    return this.reportsService.review(id, body.decision, body.comment || '', req.user);
  }

  @Post(':id/resubmit')
  @Roles(ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async resubmit(@Param('id') id: string, @Req() req) {
    return this.reportsService.resubmit(id, req.user);
  }
}
