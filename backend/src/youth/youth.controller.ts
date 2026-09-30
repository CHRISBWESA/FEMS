import { Controller, Get, Post, Put, Body, Param, Query, Req, Res } from '@nestjs/common';
import { withTotalHeader } from '../shared/utils/paging.util';
import {
  YouthService,
  CreateYouthProfileDto,
  UpdateYouthProfileDto,
  ChangeYouthStatusDto,
  AddGuardianDto,
  RecordYouthAttendanceDto,
} from './youth.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

const YOUTH_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.SECRETARY,
  ROLES.ASSISTANT_SECRETARY,
  ROLES.CHAIRPERSON,
  ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.DEPARTMENT_SECRETARY,
  ROLES.DEPARTMENT_CHAIRPERSON,
];

@RequiresModule('youth')
@Controller('youth')
export class YouthController {
  constructor(private readonly youthService: YouthService) {}

  @Get('reports/summary')
  @Roles(...YOUTH_READ_ROLES)
  async reportsSummary(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.youthService.reportsSummary(req.user, fellowshipId);
  }

  @Get()
  @Roles(...YOUTH_READ_ROLES)
  async findAll(
    @Req() req,
    @Res({ passthrough: true }) res,
    @Query('fellowshipId') fellowshipId?: string,
    @Query('ageGroupId') ageGroupId?: string,
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return withTotalHeader(res, await this.youthService.findAll(req.user, fellowshipId, { ageGroupId, status, departmentId }, page, limit));
  }

  @Get(':id')
  @Roles(...YOUTH_READ_ROLES)
  async findOne(@Param('id') id: string, @Req() req) {
    return this.youthService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async create(@Body() body: CreateYouthProfileDto, @Req() req) {
    return this.youthService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: UpdateYouthProfileDto, @Req() req) {
    return this.youthService.update(id, body, req.user);
  }

  @Post(':id/status')
  @Roles(ROLES.SECRETARY)
  async changeStatus(@Param('id') id: string, @Body() body: ChangeYouthStatusDto, @Req() req) {
    return this.youthService.changeStatus(id, body, req.user);
  }

  @Get(':id/guardians')
  @Roles(...YOUTH_READ_ROLES)
  async listGuardians(@Param('id') id: string, @Req() req) {
    return this.youthService.listGuardians(id, req.user);
  }

  @Post(':id/guardians')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async addGuardian(@Param('id') id: string, @Body() body: AddGuardianDto, @Req() req) {
    return this.youthService.addGuardian(id, body, req.user);
  }

  @Post(':id/guardians/:guardianId/remove')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async removeGuardian(@Param('id') id: string, @Param('guardianId') guardianId: string, @Req() req) {
    return this.youthService.removeGuardian(id, guardianId, req.user);
  }

  @Get(':id/attendance')
  @Roles(...YOUTH_READ_ROLES)
  async listAttendance(@Param('id') id: string, @Req() req) {
    return this.youthService.listAttendance(id, req.user);
  }

  @Post(':id/attendance')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async recordAttendance(@Param('id') id: string, @Body() body: RecordYouthAttendanceDto, @Req() req) {
    return this.youthService.recordAttendance(id, body, req.user);
  }
}
