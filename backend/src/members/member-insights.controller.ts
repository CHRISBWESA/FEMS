import { Controller, Get, Put, Body, Param, Query, Req } from '@nestjs/common';
import { MemberProfilesService, UpdateMemberProfileDto } from './member-profiles.service';
import { MembershipHistoryService } from './membership-history.service';
import { MemberEngagementService } from './member-engagement.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { RequiresModule } from '../shared/decorators/platform.decorators';

// Phase 14 member endpoints. Kept separate from MembersController so the original CRUD surface is
// untouched. The @Roles lists are only a coarse gate; every handler's service enforces the specific
// member.* permission plus tenant / department scope.
@RequiresModule('member_engagement')
@Controller('members')
export class MemberInsightsController {
  constructor(
    private readonly profiles: MemberProfilesService,
    private readonly history: MembershipHistoryService,
    private readonly engagement: MemberEngagementService,
  ) {}

  @Get('reports/summary')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async reportsSummary(
    @Req() req,
    @Query('months') months?: string,
    @Query('days') days?: string,
    @Query('fellowshipId') fellowshipId?: string,
  ) {
    return this.engagement.getReportSummary(req.user, { months, days, fellowshipId });
  }

  @Get(':id/profile')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async getProfile(@Param('id') id: string, @Req() req) {
    return this.profiles.get(id, req.user);
  }

  @Put(':id/profile')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async updateProfile(@Param('id') id: string, @Body() body: UpdateMemberProfileDto, @Req() req) {
    return this.profiles.update(id, body, req.user);
  }

  @Get(':id/history')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async getHistory(@Param('id') id: string, @Req() req) {
    return this.history.list(id, req.user);
  }

  @Get(':id/engagement')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
  )
  async getEngagement(@Param('id') id: string, @Req() req, @Query('days') days?: string) {
    return this.engagement.getMemberEngagement(id, req.user, days);
  }
}
