import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { NotificationEngineService } from './notifications/notification-engine.service';
import { ApprovalEngineService } from './approval-engine/approval-engine.service';

@Global()
@Module({
  imports: [],
  providers: [AuditService, NotificationEngineService, ApprovalEngineService],
  exports: [AuditService, NotificationEngineService, ApprovalEngineService],
})
export class SharedModule {}
