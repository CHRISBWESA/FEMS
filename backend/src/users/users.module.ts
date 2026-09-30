import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
  imports: [],
  providers: [UsersService, InvitationsService],
  controllers: [UsersController, InvitationsController],
  exports: [UsersService, InvitationsService],
})
export class UsersModule {}
