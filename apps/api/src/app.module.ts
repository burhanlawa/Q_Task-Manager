import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [HealthModule, DebugModule, AuthModule, MeModule],
})
export class AppModule {}
