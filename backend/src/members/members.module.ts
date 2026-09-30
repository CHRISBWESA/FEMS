import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { MemberAccessService } from './member-access.service';
import { MemberProfilesService } from './member-profiles.service';
import { MembershipHistoryService } from './membership-history.service';
import { MemberEngagementService } from './member-engagement.service';
import { MemberGroupsService } from './member-groups.service';
import { MemberGroupsController } from './member-groups.controller';
import { MemberInsightsController } from './member-insights.controller';

@Module({
  imports: [],
  providers: [
    MembersService,
    MemberAccessService,
    MemberProfilesService,
    MembershipHistoryService,
    MemberEngagementService,
    MemberGroupsService,
  ],
  controllers: [MembersController, MemberInsightsController, MemberGroupsController],
  exports: [MembersService],
})
export class MembersModule {}
