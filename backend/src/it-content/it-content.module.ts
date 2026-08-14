import { Module } from '@nestjs/common';
import { ItContentService } from './it-content.service';
import { ItContentController } from './it-content.controller';

@Module({
  imports: [],
  providers: [ItContentService],
  controllers: [ItContentController],
  exports: [ItContentService],
})
export class ItContentModule {}
