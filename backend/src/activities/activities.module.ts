import { Module } from '@nestjs/common';
import { AttendanceSyncService } from './attendance-sync.service';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';

@Module({
  imports: [],
  providers: [ActivitiesService, AttendanceSyncService],
  controllers: [ActivitiesController],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
