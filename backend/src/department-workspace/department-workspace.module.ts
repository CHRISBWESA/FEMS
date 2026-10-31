import { Module } from '@nestjs/common';
import { StorageModule } from '../shared/storage/storage.module';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { DepartmentLeadershipService } from './department-leadership.service';
import { DepartmentMembersService } from './department-members.service';
import { DepartmentActivitiesService } from './department-activities.service';
import { DepartmentReportsService } from './department-reports.service';
import { DepartmentFinanceService } from './department-finance.service';
import { DepartmentAnnouncementsService } from './department-announcements.service';
import { DepartmentReviewsService } from './department-reviews.service';
import { DepartmentDashboardService } from './department-dashboard.service';
import { DepartmentUploadsService } from './department-uploads.service';
import {
  DepartmentAdminController,
  DepartmentReviewsController,
  DepartmentWorkspaceController,
} from './department-workspace.controller';

/**
 * The departments management module: the Fellowship Secretary's department administration, the department
 * leaders' workspace and the review inboxes of the Secretary, Chairperson and Treasurer.
 */
@Module({
  imports: [StorageModule],
  providers: [
    DepartmentAccessService,
    DepartmentNotifier,
    DepartmentLeadershipService,
    DepartmentMembersService,
    DepartmentActivitiesService,
    DepartmentReportsService,
    DepartmentFinanceService,
    DepartmentAnnouncementsService,
    DepartmentReviewsService,
    DepartmentDashboardService,
    DepartmentUploadsService,
  ],
  controllers: [
    DepartmentAdminController,
    DepartmentWorkspaceController,
    DepartmentReviewsController,
  ],
  exports: [DepartmentLeadershipService, DepartmentAccessService],
})
export class DepartmentWorkspaceModule {}
