import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { FinanceModule } from '../finance/finance.module';
import { ResourcesModule } from '../resources/resources.module';
import { VolunteersModule } from '../volunteers/volunteers.module';
import { YouthModule } from '../youth/youth.module';

@Module({
  imports: [FinanceModule, ResourcesModule, VolunteersModule, YouthModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
