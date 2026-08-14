import { Module } from '@nestjs/common';
import { BackupsService } from './backups.service';
import { BackupsController } from './backups.controller';

@Module({
  imports: [],
  providers: [BackupsService],
  controllers: [BackupsController],
  exports: [BackupsService],
})
export class BackupsModule {}
