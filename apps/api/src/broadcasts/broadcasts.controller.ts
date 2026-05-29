import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { AudienceResolverService, type AudienceKind } from './audience-resolver.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

// POST /broadcasts — create + fan out in one shot.
//
// Flow:
//   1. Insert the broadcast row (the source-of-truth for "the company sent
//      this announcement").
//   2. Resolve the audience to a user_id list. Empty audience is allowed
//      (e.g., a custom filter to a now-deleted user) — the row stays so
//      the sender's record is preserved.
//   3. For each recipient, write a notification row via NotificationsService.
//      That writer already handles in-app vs. email channel routing through
//      user_notification_preferences and enqueues emails via BullMQ.
//   4. Record an activity_log entry for audit.
//
// Fan-out shape: we loop INLINE in the request handler. Sprint 16.x can
// move to a BullMQ broadcast-fanout queue once we see real tenants with
// 1000+ users; for now this matches the existing inline pattern for task
// assignment fan-out (tasks.controller.ts) and is the simpler thing.

@Controller('broadcasts')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class BroadcastsController {
  constructor(
    private readonly resolver: AudienceResolverService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('broadcast.send')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateBroadcastDto,
  ): Promise<{
    id: string;
    audience: AudienceKind;
    recipientCount: number;
    notifiedCount: number;
  }> {
    const filter = dto.audience_filter ?? {};

    // Resolve first so a misconfigured audience (e.g. branch with no
    // branch_id) errors BEFORE we write the broadcast row.
    const recipientIds = await this.resolver.resolve(db, tenant.companyId, dto.audience, filter);

    const broadcast = await db.broadcast.create({
      data: {
        companyId: tenant.companyId,
        senderUserId: tenant.userId,
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        audienceFilter: filter as Prisma.InputJsonValue,
      },
    });

    // Fan-out. NotificationsService is responsible for:
    //   - reading user_notification_preferences (gates in-app + email)
    //   - inserting the per-user notification row
    //   - firing Pusher real-time for the bell
    //   - enqueueing the email job when prefs allow
    let notifiedCount = 0;
    for (const recipientId of recipientIds) {
      const result = await this.notifications.create(db, {
        recipientId,
        companyId: tenant.companyId,
        type: 'broadcast',
        title: dto.title,
        message: dto.body,
        relatedEntityType: 'broadcast',
        relatedEntityId: broadcast.id,
        actionUrl: `/broadcasts/${broadcast.id}`,
        actorUserId: tenant.userId,
        metadata: {
          title: dto.title,
          messageBody: dto.body,
          audience: dto.audience,
        },
      });
      if (result) notifiedCount++;
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'broadcast_sent',
      targetType: 'broadcast',
      targetId: broadcast.id,
      metadata: {
        audience: dto.audience,
        recipientCount: recipientIds.length,
        notifiedCount,
      },
    });

    return {
      id: broadcast.id,
      audience: dto.audience,
      recipientCount: recipientIds.length,
      notifiedCount,
    };
  }
}
