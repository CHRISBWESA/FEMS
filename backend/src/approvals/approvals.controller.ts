import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // findPendingForUser already filters to the caller's own approver role/user, so every role that can
  // approve something may call it. (It used to be admin-only, which made it return nothing for everyone.)
  @Get()
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async findPendingForUser(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.approvalsService.findPendingForUser(req.user, fellowshipId);
  }

  @Post(':id/decide')
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async decide(
    @Param('id') id: string,
    @Body() body: { decision: 'approved' | 'rejected'; comment?: string },
    @Req() req,
  ) {
    return this.approvalsService.decide(id, body?.decision, body?.comment || '', req.user);
  }
}
