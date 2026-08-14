import { Module } from '@nestjs/common';
import { RecycleBinService } from './recycle-bin.service';
import { RecycleBinController } from './recycle-bin.controller';

@Module({
  imports: [],
  providers: [RecycleBinService],
  controllers: [RecycleBinController],
  exports: [RecycleBinService],
})
export class RecycleBinModule {}
