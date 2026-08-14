import { Module } from '@nestjs/common';
import { AuditQueryService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [],
  providers: [AuditQueryService],
  controllers: [AuditController],
  exports: [AuditQueryService],
})
export class AuditModule {}
