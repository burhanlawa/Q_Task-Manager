import { Global, Module } from '@nestjs/common';
import { ActivityLogDebugController } from './activity-log-debug.controller';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';

@Global()
@Module({
  controllers: [ActivityLogController, ActivityLogDebugController],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
