import { Controller, Get, Post, Put, Body, Delete, Param, UseGuards, Req } from '@nestjs/common';
import { UsersService, CreateUserDto } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, Permissions } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { RolesGuard } from '../shared/authorization/roles.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async create(@Body() body: CreateUserDto, @Req() req) {
    return this.usersService.create(body, req.user?.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SECRETARY)
  async findAll(
    @Body() body: { role?: string; isActive?: boolean; page?: number; limit?: number },
    @Req() req,
  ) {
    return this.usersService.findAll(body, req.user?.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Put(':id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async assignRoles(@Param('id') id: string, @Body() body: { roles: string[] }, @Req() req) {
    return this.usersService.assignRoles(id, body.roles as any, req.user?.userId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async update(@Param('id') id: string, @Body() body: Partial<CreateUserDto>, @Req() req) {
    return this.usersService.update(id, body, req.user?.userId);
  }

  @Put(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async deactivate(@Param('id') id: string, @Req() req) {
    return this.usersService.setActive(id, false, req.user?.userId);
  }

  @Put(':id/activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async activate(@Param('id') id: string, @Req() req) {
    return this.usersService.setActive(id, true, req.user?.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @Permissions(PERMISSIONS.USER_MANAGE)
  async delete(@Param('id') id: string, @Req() req) {
    return this.usersService.delete(id, req.user?.userId);
  }

  @Get('permissions/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async getPermissions() {
    return this.usersService.getPermissions();
  }

  @Get('roles/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getRoles() {
    return this.usersService.getRoles();
  }
}
