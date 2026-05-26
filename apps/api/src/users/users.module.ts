import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, InvitationsController],
  providers: [UsersService],
})
export class UsersModule {}
