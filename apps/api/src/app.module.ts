import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';

@Module({
  imports: [HealthModule, DebugModule],
})
export class AppModule {}
