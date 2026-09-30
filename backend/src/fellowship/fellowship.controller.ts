import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { FellowshipService, CreateFellowshipDto, UpdateFellowshipDto } from './fellowship.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../shared/authorization/roles.guard';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PlatformAccess } from '../shared/decorators/platform.decorators';

@PlatformAccess()
@Controller('fellowships')
export class FellowshipController {
  constructor(private readonly fellowshipService: FellowshipService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async findAll(@Query() query: any, @Req() req) {
    return this.fellowshipService.findAll(
      {
        search: query.search,
        isActive: query.isActive !== undefined ? query.isActive === 'true' : undefined,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 50,
      },
      req.user?.userId,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async findOne(@Param('id') id: string) {
    return this.fellowshipService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async create(@Body() body: CreateFellowshipDto, @Req() req) {
    return this.fellowshipService.create(body, req.user?.userId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async update(@Param('id') id: string, @Body() body: UpdateFellowshipDto, @Req() req) {
    return this.fellowshipService.update(id, body, req.user?.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async remove(@Param('id') id: string, @Req() req) {
    return this.fellowshipService.remove(id, req.user?.userId);
  }
}
