import { Controller, Get, Post, Delete, Param, Body, Req } from '@nestjs/common';
import { RecycleBinService } from './recycle-bin.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('recycle-bin')
export class RecycleBinController {
  constructor(private readonly recycleBinService: RecycleBinService) {}

  @Get()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async findAll(@Req() req) {
    return this.recycleBinService.findAll(req.user);
  }

  @Post(':id/restore')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async restore(@Param('id') id: string, @Req() req) {
    return this.recycleBinService.restore(id, req.user);
  }

  @Delete(':id')
  @Roles(ROLES.SECRETARY)
  async permanentDelete(@Param('id') id: string, @Req() req) {
    return this.recycleBinService.permanentDelete(id, req.user);
  }
}
