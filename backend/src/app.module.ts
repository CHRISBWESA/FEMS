
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter';

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
import { ApprovalsModule } from './approvals/approvals.module';
import { FellowshipModule } from './fellowship/fellowship.module';
import { YouthModule } from './youth/youth.module';
import { ResourcesModule } from './resources/resources.module';
import { VolunteersModule } from './volunteers/volunteers.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PlatformModule } from './platform/platform.module';
import { BillingModule } from './billing/billing.module';
import { PublicSiteModule } from './public-site/public-site.module';
import { PlatformBoundaryGuard } from './shared/authorization/platform-boundary.guard';
import { MustChangePasswordGuard } from './shared/authorization/must-change-password.guard';
import { ModuleAvailabilityGuard } from './shared/modules/module-availability.guard';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';
import { StorageModule } from './shared/storage/storage.module';
import { RolesGuard } from './shared/authorization/roles.guard';
import { DepartmentScopeGuard } from './shared/authorization/department-scope.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { HealthController, DiagnosticsService } from './health.controller';
import { RejectNulBytesMiddleware } from './shared/middleware/reject-nul-bytes.middleware';
import { RequestContextMiddleware } from './shared/middleware/request-context.middleware';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'production' }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            // ttl is in MILLISECONDS in @nestjs/throttler v6. This used to divide by 1000 (a 0.9 second window), which
            // made the limit meaningless. Default: 600 requests per minute per client IP; sign-in etc. are much tighter
            // (see shared/throttle.ts).
            ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000),
            limit: config.get<number>('RATE_LIMIT_MAX', 600),
          },
        ],
      }),
    }),
    PrismaModule,
    SharedModule,
    StorageModule,
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
    ApprovalsModule,
    FellowshipModule,
    YouthModule,
    ResourcesModule,
    VolunteersModule,
    AnalyticsModule,
    PlatformModule,
    BillingModule,
    PublicSiteModule,
  ],
  providers: [
    DiagnosticsService,
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // A temporary password only allows changing it (and signing out / reading the profile).
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      // Keeps platform accounts out of every controller that is not marked @PlatformAccess().
      provide: APP_GUARD,
      useClass: PlatformBoundaryGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ModuleAvailabilityGuard,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, RejectNulBytesMiddleware).forRoutes('*');
  }
}
