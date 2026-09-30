import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Res,
} from '@nestjs/common';
import { withTotalHeader } from '../shared/utils/paging.util';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_THROTTLE } from '../shared/throttle';
import { AttendanceSyncService } from './attendance-sync.service';
import { ActivitiesService, CreateActivityDto } from './activities.service';
import { Roles } from '../shared/decorators/role.decorators';
import { Public } from '../shared/decorators/public.decorator';
import { ROLES } from '../shared/authorization/roles';

@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly attendanceSync: AttendanceSyncService,
  ) {}

  @Get()
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findAll(
    @Req() req,
    @Res({ passthrough: true }) res,
    @Query('fellowshipId') fellowshipId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return withTotalHeader(res, await this.activitiesService.findAll(req.user, fellowshipId, page, limit));
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
    ROLES.ORDINARY_MEMBER,
  )
  async findOne(@Param('id') id: string, @Req() req) {
    return this.activitiesService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async create(@Body() body: CreateActivityDto, @Req() req) {
    return this.activitiesService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async update(@Param('id') id: string, @Body() body: Partial<CreateActivityDto>, @Req() req) {
    return this.activitiesService.update(id, body, req.user);
  }

  @Post(':id/cancel')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async cancel(@Param('id') id: string, @Req() req) {
    return this.activitiesService.cancel(id, req.user);
  }

  @Post(':id/attendance-link')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async generateLink(@Param('id') id: string, @Req() req) {
    return this.activitiesService.generateAttendanceLink(id, req.user);
  }

  @Post('attendance')
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  async recordAttendance(@Body() body: { activityId: string; memberName?: string }) {
    // Public route: name only. A client-supplied memberId is intentionally ignored.
    return this.activitiesService.recordAttendance(body.activityId, {
      memberName: body.memberName,
    });
  }

  // Offline attendance: what a device downloads, and the idempotent sync of what it recorded offline.
  @Get(':id/attendance/roster')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async attendanceRoster(@Param('id') id: string, @Req() req) {
    return this.attendanceSync.roster(id, req.user);
  }

  @Post(':id/attendance/sync')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async syncAttendance(@Param('id') id: string, @Body() body: { ops: unknown }, @Req() req) {
    return this.attendanceSync.sync(id, body, req.user);
  }

  @Post(':id/attendance/members')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async recordMemberAttendance(
    @Param('id') id: string,
    @Body() body: { memberIds: string[] },
    @Req() req,
  ) {
    return this.activitiesService.recordMemberAttendance(id, body?.memberIds, req.user);
  }

  @Get(':id/attendance')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    )
  async getAttendance(@Param('id') id: string, @Req() req) {
    return this.activitiesService.getAttendance(id, req.user);
  }
}
