import { Module } from '@nestjs/common';
import { FellowshipController } from './fellowship.controller';
import { FellowshipService } from './fellowship.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [FellowshipController],
  providers: [FellowshipService],
  exports: [FellowshipService],
})
export class FellowshipModule {}
