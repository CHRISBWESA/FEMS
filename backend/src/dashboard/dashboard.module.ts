import { Module } from '@nestjs/common';
import { DashboardController, ProfileController } from './dashboard.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';

@Module({
  imports: [],
  providers: [PrismaService, AuditService],
  controllers: [DashboardController, ProfileController],
})
export class DashboardModule {}
