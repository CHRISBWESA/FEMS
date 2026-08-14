import { Controller, Get, Query, Param, Req } from '@nestjs/common';
import { AuditQueryService } from './audit.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.CHAIRPERSON)
  async findAll(@Query() query: any, @Req() req) {
    return this.auditQueryService.findAll(query, req.user);
  }

  @Get('stats')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.CHAIRPERSON)
  async stats(@Req() req) {
    return this.auditQueryService.getStats(req.user);
  }

  @Get('impersonation/:sessionId')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.CHAIRPERSON)
  async impersonationLogs(@Param('sessionId') sessionId: string, @Req() req) {
    return this.auditQueryService.getImpersonationLogs(sessionId, req.user);
  }
}
