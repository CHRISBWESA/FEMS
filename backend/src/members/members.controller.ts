import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MembersService, CreateMemberDto, UpdateMemberDto } from './members.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PERMISSIONS } from '../shared/authorization/permissions';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.GENDER_LEADER,
  )
  async findAll(@Query() query: any, @Req() req) {
    return this.membersService.findAll(query, req.user);
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
    ROLES.GENDER_LEADER,
  )
  async findOne(@Param('id') id: string, @Req() req) {
    return this.membersService.findOne(id, req.user);
  }

  @Post()
  @Roles(ROLES.SECRETARY, ROLES.GENDER_LEADER, ROLES.ADMIN)
  async create(@Body() body: CreateMemberDto, @Req() req) {
    return this.membersService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: UpdateMemberDto, @Req() req) {
    return this.membersService.update(id, body, req.user);
  }

  @Put(':id/status')
  @Roles(ROLES.SECRETARY)
  async changeStatus(@Param('id') id: string, @Body() body: { status: string; reason?: string }, @Req() req) {
    return this.membersService.changeStatus(id, body.status, req.user, body.reason);
  }

  @Put(':id/graduation')
  @Roles(ROLES.SECRETARY)
  async updateGraduation(
    @Param('id') id: string,
    @Body() body: { year: number; month: number },
    @Req() req,
  ) {
    return this.membersService.updateGraduation(id, body.year, body.month, req.user);
  }

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @Roles(ROLES.SECRETARY, ROLES.ADMIN)
  async bulkUpload(@UploadedFile() file: Express.Multer.File, @Req() req) {
    return this.membersService.bulkCreate(file, req.user);
  }

  @Post(':id/departments/:departmentId')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async addToDepartment(@Param('id') id: string, @Param('departmentId') departmentId: string, @Req() req) {
    return this.membersService.addToDepartment(id, departmentId, req.user);
  }
}
