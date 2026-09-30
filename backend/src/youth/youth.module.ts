import { Module } from '@nestjs/common';
import { YouthService } from './youth.service';
import { YouthController } from './youth.controller';
import { YouthAgeGroupsService } from './youth-age-groups.service';
import { YouthAgeGroupsController } from './youth-age-groups.controller';

@Module({
  imports: [],
  providers: [YouthService, YouthAgeGroupsService],
  // YouthAgeGroupsController must be registered BEFORE YouthController: its static
  // /youth/age-groups routes would otherwise be captured by YouthController's dynamic GET /youth/:id.
  controllers: [YouthAgeGroupsController, YouthController],
  exports: [YouthService, YouthAgeGroupsService],
})
export class YouthModule {}
