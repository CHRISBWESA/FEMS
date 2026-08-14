import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [],
  controllers: [DashboardController],
})
export class DashboardModule {}
