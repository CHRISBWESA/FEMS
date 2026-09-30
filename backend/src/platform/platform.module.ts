import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { SupportController } from './support.controller';
import { RegistrationPlatformController, RegistrationPublicController } from './registration.controller';
import { ImpersonationPlatformController, ImpersonationClientController } from './impersonation.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformOnboardingService } from './platform-onboarding.service';
import { PlatformSupportService } from './platform-support.service';
import { PlatformStaffService } from './platform-staff.service';
import { FellowshipRegistrationService } from './platform-registration.service';
import { ImpersonationService } from './impersonation.service';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, BillingModule, AuthModule],
  providers: [
    PlatformTenantsService, PlatformOnboardingService, PlatformSupportService, PlatformStaffService,
    FellowshipRegistrationService, ImpersonationService,
  ],
  controllers: [
    PlatformController, SupportController,
    RegistrationPublicController, RegistrationPlatformController,
    ImpersonationPlatformController, ImpersonationClientController,
  ],
})
export class PlatformModule {}
