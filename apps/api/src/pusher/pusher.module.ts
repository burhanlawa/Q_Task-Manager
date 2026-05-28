import { Global, Module } from '@nestjs/common';
import { PusherController } from './pusher.controller';
import { PusherService } from './pusher.service';

// Global so NotificationsService can inject PusherService without a
// dependency cycle. Same shape as ActivityLogModule + NotificationsModule.
@Global()
@Module({
  controllers: [PusherController],
  providers: [PusherService],
  exports: [PusherService],
})
export class PusherModule {}
