import { Controller, Get, Post, Put, Body, Param, Query, Req } from '@nestjs/common';
import { YouthAgeGroupsService, CreateAgeGroupDto, UpdateAgeGroupDto } from './youth-age-groups.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

@RequiresModule('youth')
@Controller('youth/age-groups')
export class YouthAgeGroupsController {
  constructor(private readonly ageGroupsService: YouthAgeGroupsService) {}

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
  async findAll(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.ageGroupsService.findAll(req.user, fellowshipId);
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
    return this.ageGroupsService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.SECRETARY)
  async create(@Body() body: CreateAgeGroupDto, @Req() req) {
    return this.ageGroupsService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: UpdateAgeGroupDto, @Req() req) {
    return this.ageGroupsService.update(id, body, req.user);
  }

  @Post('recalculate')
  @Roles(ROLES.SECRETARY)
  async recalculate(@Req() req) {
    return this.ageGroupsService.recalculate(req.user);
  }
}
