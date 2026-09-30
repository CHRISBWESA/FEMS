import { Controller, Get, Post, Put, Body, Param, Query, Req } from '@nestjs/common';
import { MemberGroupsService, CreateMemberGroupDto, UpdateMemberGroupDto } from './member-groups.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

@RequiresModule('member_engagement')
@Controller('member-groups')
export class MemberGroupsController {
  constructor(private readonly groupsService: MemberGroupsService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async findAll(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.groupsService.findAll(req.user, fellowshipId);
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
  async findOne(@Param('id') id: string, @Req() req) {
    return this.groupsService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async create(@Body() body: CreateMemberGroupDto, @Req() req) {
    return this.groupsService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async update(@Param('id') id: string, @Body() body: UpdateMemberGroupDto, @Req() req) {
    return this.groupsService.update(id, body, req.user);
  }

  @Post(':id/members')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async addMembers(@Param('id') id: string, @Body() body: { memberIds: string[] }, @Req() req) {
    return this.groupsService.addMembers(id, body?.memberIds, req.user);
  }

  @Post(':id/members/:memberId/remove')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @Req() req) {
    return this.groupsService.removeMember(id, memberId, req.user);
  }
}
