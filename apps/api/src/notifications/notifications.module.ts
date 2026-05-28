import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsDebugController } from './notifications-debug.controller';
import { NotificationsService } from './notifications.service';

// Global so any feature module (comments, tasks, files, etc.) can inject
// NotificationsService without an explicit import — the same shape we use
// for ActivityLogService.
@Global()
@Module({
  controllers: [NotificationsController, NotificationsDebugController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
