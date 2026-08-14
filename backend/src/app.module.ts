
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MembersModule } from './members/members.module';
import { ProgrammesModule } from './programmes/programmes.module';
import { DepartmentsModule } from './departments/departments.module';
import { ActivitiesModule } from './activities/activities.module';
import { ReportsModule } from './reports/reports.module';
import { FinanceModule } from './finance/finance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { RecycleBinModule } from './recycle-bin/recycle-bin.module';
import { BackupsModule } from './backups/backups.module';
import { ItContentModule } from './it-content/it-content.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ModelsModule } from './models.module';
import { SharedModule } from './shared/shared.module';
import { RolesGuard } from './shared/authorization/roles.guard';
import { DepartmentScopeGuard } from './shared/authorization/department-scope.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 900000) / 1000,
            limit: config.get<number>('RATE_LIMIT_MAX', 100),
          },
        ],
      }),
    }),
    ModelsModule,
    SharedModule,
    AuthModule,
    UsersModule,
    MembersModule,
    ProgrammesModule,
    DepartmentsModule,
    ActivitiesModule,
    ReportsModule,
    FinanceModule,
    NotificationsModule,
    AuditModule,
    RecycleBinModule,
    BackupsModule,
    ItContentModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DepartmentScopeGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
