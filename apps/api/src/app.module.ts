import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { CryptoModule } from './crypto/crypto.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './departments/departments.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '../../.env'), join(process.cwd(), '.env')],
    }),
    // In-memory throttling: 60 requests / minute / IP. Acceptable on our current
    // single-replica deploy; swap to ThrottlerStorageRedisService once REDIS_URL
    // is real and we scale beyond one replica (deferred — see commit message).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    TenantModule,
    ActivityLogModule,
    CryptoModule,
    HealthModule,
    DebugModule,
    AuthModule,
    MeModule,
    WebhooksModule,
    BranchesModule,
    DepartmentsModule,
    TeamsModule,
    UsersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
