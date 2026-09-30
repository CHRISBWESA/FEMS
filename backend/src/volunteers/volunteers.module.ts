import { Module } from '@nestjs/common';
import { VolunteersController } from './volunteers.controller';
import { VolunteersAccessService } from './volunteers-access.service';
import { VolunteerRolesService } from './volunteer-roles.service';
import { VolunteerOpportunitiesService } from './volunteer-opportunities.service';
import { VolunteerAssignmentsService } from './volunteer-assignments.service';
import { VolunteerReportsService } from './volunteer-reports.service';

@Module({
  providers: [
    VolunteersAccessService,
    VolunteerRolesService,
    VolunteerOpportunitiesService,
    VolunteerAssignmentsService,
    VolunteerReportsService,
  ],
  controllers: [VolunteersController],
  exports: [VolunteerReportsService],
})
export class VolunteersModule {}
