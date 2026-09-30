import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { NotificationEngineService } from './notifications/notification-engine.service';
import { ApprovalEngineService } from './approval-engine/approval-engine.service';
import { TenantScopeService } from './tenant/tenant-scope.service';
import { ModuleAvailabilityService } from './modules/module-availability.service';
import { EntitlementsService } from './billing/entitlements.service';

@Global()
@Module({
  imports: [],
  providers: [AuditService, NotificationEngineService, ApprovalEngineService, TenantScopeService, ModuleAvailabilityService, EntitlementsService],
  exports: [AuditService, NotificationEngineService, ApprovalEngineService, TenantScopeService, ModuleAvailabilityService, EntitlementsService],
})
export class SharedModule {}
