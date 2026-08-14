import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActivitiesService, CreateActivityDto } from './activities.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findAll(@Req() req) {
    return this.activitiesService.findAll(req.user);
  }

  @Get(':id')
  @Roles(
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
  async recordAttendance(@Body() body: { activityId: string; memberName?: string; memberId?: string }) {
    return this.activitiesService.recordAttendance(body.activityId, {
      memberId: body.memberId,
      memberName: body.memberName,
    });
  }

  @Get(':id/attendance')
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    )
  async getAttendance(@Param('id') id: string, @Req() req) {
    return this.activitiesService.getAttendance(id, req.user);
  }
}
