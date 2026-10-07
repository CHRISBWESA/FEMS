import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MembersService, CreateMemberDto, UpdateMemberDto, CreateRegistrationLinkDto, RegisterMemberViaLinkDto, VerifyMemberDto, RejectMemberDto, ExportMembersDto } from './members.service';
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

  // --- Member Registration Link & Verification ---

  @Post('registration-link')
  @Roles(ROLES.SECRETARY)
  async createRegistrationLink(@Body() dto: CreateRegistrationLinkDto, @Req() req) {
    return this.membersService.createRegistrationLink({ ...dto, createdBy: req.user.userId });
  }

  @Post('register-via-link/:token')
  async registerMemberViaLink(@Param('token') token: string, @Body() dto: RegisterMemberViaLinkDto) {
    return this.membersService.registerMemberViaLink(token, dto);
  }

  @Get('pending-verification')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async getPendingVerifications(@Query('fellowshipId') fellowshipId: string, @Req() req) {
    return this.membersService.getPendingVerifications(fellowshipId, req.user);
  }

  @Put('verify/:verificationId')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async verifyMember(@Param('verificationId') verificationId: string, @Body() dto: VerifyMemberDto, @Req() req) {
    return this.membersService.verifyMember(verificationId, dto, req.user);
  }

  @Put('reject/:verificationId')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async rejectMember(@Param('verificationId') verificationId: string, @Body() dto: RejectMemberDto, @Req() req) {
    return this.membersService.rejectMember(verificationId, dto, req.user);
  }

  @Put('pending-verification/:verificationId')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async editPendingVerification(@Param('verificationId') verificationId: string, @Body() dto: VerifyMemberDto, @Req() req) {
    return this.membersService.editPendingVerification(verificationId, dto, req.user);
  }

  @Get('export')
  @Roles(ROLES.SECRETARY)
  async exportMembers(@Query() query: ExportMembersDto, @Req() req, @Res() res) {
    const buffer = await this.membersService.exportMembers(req.user.fellowshipId, query, req.user);
    const filename = `members_export_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
