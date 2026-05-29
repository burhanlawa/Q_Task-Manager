import { Module } from '@nestjs/common';
import { AudienceResolverService } from './audience-resolver.service';
import { BroadcastsController } from './broadcasts.controller';

// NotificationsService + ActivityLogService are provided by their @Global()
// modules, so we only register what's local to broadcasts here.
@Module({
  controllers: [BroadcastsController],
  providers: [AudienceResolverService],
  exports: [AudienceResolverService],
})
export class BroadcastsModule {}
