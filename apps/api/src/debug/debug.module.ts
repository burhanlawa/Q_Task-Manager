import { Module } from '@nestjs/common';
import { DebugSentryController } from './debug.controller';

@Module({
  controllers: [DebugSentryController],
})
export class DebugModule {}
