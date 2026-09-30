import { Controller, Get, Post, Body, Param, Query, Req, Res } from '@nestjs/common';
import { withTotalHeader } from '../shared/utils/paging.util';
import { ReportsService, SubmitReportDto } from './reports.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async findAll(
    @Req() req,
    @Res({ passthrough: true }) res,
    @Query('fellowshipId') fellowshipId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return withTotalHeader(res, await this.reportsService.findAll(req.user, fellowshipId, page, limit));
  }

  @Get(':id')
  @Roles(
    ROLES.ADMIN,
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
