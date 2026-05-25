import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '../../.env'), join(process.cwd(), '.env')],
    }),
    PrismaModule,
    HealthModule,
    DebugModule,
    AuthModule,
    MeModule,
    WebhooksModule,
  ],
})
export class AppModule {}
