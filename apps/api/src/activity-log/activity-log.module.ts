import { Global, Module } from '@nestjs/common';
import { ActivityLogDebugController } from './activity-log-debug.controller';
import { ActivityLogService } from './activity-log.service';

@Global()
@Module({
  controllers: [ActivityLogDebugController],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
