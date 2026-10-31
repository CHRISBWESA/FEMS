import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { DepartmentsService, CreateDepartmentDto, AssignLeaderDto, RequestTransferDto, RequestRemovalDto } from './departments.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { DepartmentLeadershipService } from '../department-workspace/department-leadership.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly departmentsService: DepartmentsService,
    private readonly leadership: DepartmentLeadershipService,
    private readonly prisma: PrismaService,
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
  )
  async findAll(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.departmentsService.findAll(req.user, fellowshipId);
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
    return this.departmentsService.findOne(id, req.user);
  }

  @Get(':id/members')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async getMembers(@Param('id') id: string, @Req() req) {
    return this.departmentsService.getMembers(id, req.user);
  }

  @Post()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async create(@Body() body: CreateDepartmentDto, @Req() req) {
    return this.departmentsService.create(body, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: Partial<CreateDepartmentDto>, @Req() req) {
    return this.departmentsService.update(id, body, req.user);
  }

  @Post(':id/leaders')
  @Roles(ROLES.SECRETARY)
  async assignLeader(@Param('id') id: string, @Body() body: AssignLeaderDto, @Req() req) {
    // Older clients appoint by account id. Appointments now go through the member record (see
    // DepartmentLeadershipService), so the account is mapped to its member and handled the same way.
    const member = body?.userId ? await this.prisma.member.findFirst({ where: { user_id: body.userId }, select: { id: true } }) : null;
    if (!member) throw new BadRequestException('Leaders are appointed from registered members. Use the member to appoint.');
    const result = await this.leadership.appoint(req.user, id, { memberId: member.id, role: body.roleInDepartment });
    return result.department;
  }

  @Post(':id/leaders/:userId/remove')
  @Roles(ROLES.SECRETARY)
  async removeLeader(@Param('id') id: string, @Param('userId') userId: string, @Req() req) {
    const held = await this.prisma.departmentLeader.findMany({ where: { department_id: id, user_id: userId, active_role: { not: null } } });
    if (held.length === 0) throw new BadRequestException('This account does not currently lead the department.');
    let result: any;
    for (const h of held) result = await this.leadership.vacate(req.user, id, h.active_role, 'removed');
    return result;
  }

  @Post('transfers')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async requestTransfer(@Body() body: RequestTransferDto, @Req() req) {
    return this.departmentsService.transferRequest(body, req.user);
  }

  @Post(':departmentId/members/:memberId/remove')
  @Roles(ROLES.DEPARTMENT_SECRETARY, ROLES.DEPARTMENT_CHAIRPERSON)
  async requestRemoval(
    @Param('departmentId') departmentId: string,
    @Param('memberId') memberId: string,
    @Body() body: RequestRemovalDto,
    @Req() req,
  ) {
    return this.departmentsService.requestRemoval(departmentId, memberId, body, req.user);
  }
}
