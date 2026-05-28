import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { NOTIFICATIONS_CLEANUP_QUEUE } from '../queue/queue.constants';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { NotificationsService } from './notifications.service';

class DebugNotifyDto {
  /// Defaults to the caller's own user id. The schema enforces tenant
  /// match via RLS, so cross-tenant ids will silently bounce.
  @IsOptional()
  @IsUUID()
  recipient_id?: string;

  @IsString()
  @Length(1, 100)
  type!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  message?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  related_entity_type?: string;

  @IsOptional()
  @IsUUID()
  related_entity_id?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';

  @IsOptional()
  @IsString()
  @Length(0, 500)
  action_url?: string;
}

// POST /notifications/debug-notify
//   Test/debug endpoint that hits NotificationsService.create with the
//   request body. Used by the Sprint 14.2 done check. Auth-only (clerk
//   guard) so a stray external caller can't spam.
@Controller('notifications')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class NotificationsDebugController {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectQueue(NOTIFICATIONS_CLEANUP_QUEUE) private readonly cleanupQueue: Queue,
  ) {}

  // POST /notifications/debug-run-cleanup
  //   Used by the 14.8 done check — fires the cleanup processor immediately
  //   instead of waiting for the 03:00 UTC cron tick. Polls the job state
  //   until it reaches 'completed' or 'failed', then returns the worker's
  //   return value. Simpler than QueueEvents subscriber + works the same.
  @Post('debug-run-cleanup')
  @HttpCode(200)
  async runCleanup() {
    const job = await this.cleanupQueue.add(
      'run',
      {},
      // Keep the job around briefly so we can poll its returnvalue; the cron
      // run uses removeOnComplete which is fine because nobody waits on it.
      { removeOnComplete: { age: 60 } },
    );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = await job.getState();
      if (state === 'completed') return job.returnvalue as { deleted: number };
      if (state === 'failed') {
        throw new Error(`cleanup job failed: ${job.failedReason ?? 'unknown'}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('cleanup job timed out after 30s');
  }

  @Post('debug-notify')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: DebugNotifyDto,
  ) {
    return this.notifications.create(db, {
      recipientId: dto.recipient_id ?? tenant.userId,
      companyId: tenant.companyId,
      type: dto.type,
      title: dto.title ?? null,
      message: dto.message ?? null,
      relatedEntityType: dto.related_entity_type ?? null,
      relatedEntityId: dto.related_entity_id ?? null,
      priority: dto.priority,
      actionUrl: dto.action_url ?? null,
      actorUserId: tenant.userId,
    });
  }
}
