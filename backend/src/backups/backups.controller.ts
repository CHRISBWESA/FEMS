import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { BackupsService } from './backups.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PlatformAccess } from '../shared/decorators/platform.decorators';

@PlatformAccess()
@Controller('backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Get()
  @Roles(ROLES.ADMIN)
  async findAll(@Req() req) {
    return this.backupsService.findAll(req.user);
  }

  @Get('stats')
  @Roles(ROLES.ADMIN)
  async stats(@Req() req) {
    return this.backupsService.getStats();
  }

  @Post()
  @Roles(ROLES.ADMIN)
  async createManual(@Req() req) {
    return this.backupsService.createManual(req.user);
  }

  @Post(':id/restore')
  @Roles(ROLES.ADMIN)
  async restore(
    @Param('id') id: string,
    @Body() body: { confirmSafetyBackup: boolean; reason?: string },
    @Req() req,
  ) {
    return this.backupsService.restore(id, req.user, body);
  }
}
