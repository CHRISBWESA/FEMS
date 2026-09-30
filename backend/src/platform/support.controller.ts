import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { PlatformSupportService } from './platform-support.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

// The fellowship's side of support access: the Secretary sees who asked for what and why, and approves, denies
// or revokes it. Not a platform route - platform accounts cannot reach it (they cannot approve their own requests).
@Roles(ROLES.SECRETARY)
@Controller('support')
export class SupportController {
  constructor(private readonly support: PlatformSupportService) {}

  @Get('grants')
  list(@Req() req) { return this.support.listForTenant(req.user); }
  @Post('grants/:id/decide')
  decide(@Param('id') id: string, @Body() b: any, @Req() req) { return this.support.decide(req.user, id, b); }
  @Post('grants/:id/revoke')
  revoke(@Param('id') id: string, @Req() req) { return this.support.revoke(req.user, id); }
}
