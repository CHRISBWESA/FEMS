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
import { DepartmentsService, CreateDepartmentDto, AssignLeaderDto, RequestTransferDto, RequestRemovalDto } from './departments.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

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
    return this.departmentsService.findAll(req.user);
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
    return this.departmentsService.findOne(id, req.user);
  }

  @Get(':id/members')
  @Roles(
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
    return this.departmentsService.assignLeader(id, body, req.user);
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
