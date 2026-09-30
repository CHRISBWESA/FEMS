import { Module } from '@nestjs/common';
import { DashboardController, ProfileController } from './dashboard.controller';

@Module({
  imports: [],
  // ProfileController was defined but never registered, so GET /profile did not exist.
  controllers: [DashboardController, ProfileController],
})
export class DashboardModule {}
