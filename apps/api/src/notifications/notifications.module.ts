import { Global, Module } from '@nestjs/common';
import { NotificationsDebugController } from './notifications-debug.controller';
import { NotificationsService } from './notifications.service';

// Global so any feature module (comments, tasks, files, etc.) can inject
// NotificationsService without an explicit import — the same shape we use
// for ActivityLogService.
@Global()
@Module({
  controllers: [NotificationsDebugController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
