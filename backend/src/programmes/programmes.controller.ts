import { Controller, Get, Post, Put, Delete, Body, Param, Req } from '@nestjs/common';
import { ProgrammesService, CreateProgrammeDto } from './programmes.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('programmes')
export class ProgrammesController {
  constructor(private readonly programmesService: ProgrammesService) {}

  @Get()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async findAll() {
    return this.programmesService.findAll();
  }

  @Post()
  @Roles(ROLES.SECRETARY)
  async create(@Body() body: CreateProgrammeDto, @Req() req) {
    return this.programmesService.create(body, req.user?.userId);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: CreateProgrammeDto, @Req() req) {
    return this.programmesService.update(id, body, req.user?.userId);
  }

  @Delete(':id')
  @Roles(ROLES.SECRETARY)
  async remove(@Param('id') id: string, @Req() req) {
    await this.programmesService.remove(id, req.user?.userId);
    return { message: 'Programme deleted' };
  }
}
