import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BillingStatusGuard } from './auth/billing-status.guard';
import { join } from 'path';
import { HealthModule } from './health/health.module';
import { DebugModule } from './debug/debug.module';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { MeModule } from './me/me.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { BillingModule } from './billing/billing.module';
import { CryptoModule } from './crypto/crypto.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { EmailModule } from './emails/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { PusherModule } from './pusher/pusher.module';
import { QueueModule } from './queue/queue.module';
import { R2Module } from './r2/r2.module';
import { TenantModule } from './tenant/tenant.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BranchesModule } from './branches/branches.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { CalendarModule } from './calendar/calendar.module';
import { CommentsModule } from './comments/comments.module';
import { CompanySettingsModule } from './company-settings/company-settings.module';
import { DepartmentsModule } from './departments/departments.module';
import { FilesModule } from './files/files.module';
import { TeamsModule } from './teams/teams.module';
import { RolesModule } from './roles/roles.module';
import { TagsModule } from './tags/tags.module';
import { TasksModule } from './tasks/tasks.module';
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
    CacheModule,
    PusherModule,
    QueueModule,
    R2Module,
    TenantModule,
    ActivityLogModule,
    BillingModule,
    CryptoModule,
    EmailModule,
    NotificationsModule,
    HealthModule,
    DebugModule,
    AuthModule,
    MeModule,
    WebhooksModule,
    BranchesModule,
    BroadcastsModule,
    CalendarModule,
    CommentsModule,
    CompanySettingsModule,
    DepartmentsModule,
    FilesModule,
    TeamsModule,
    UsersModule,
    RolesModule,
    TagsModule,
    TasksModule,
    ReportsModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Sprint 20.7 — 402 on writes when the tenant is read-only /
    // suspended / cancelled. Runs after Clerk auth (which only sets
    // req.auth on signed-in routes); webhooks fall through because
    // they have no Clerk session.
    { provide: APP_GUARD, useClass: BillingStatusGuard },
  ],
})
export class AppModule {}
