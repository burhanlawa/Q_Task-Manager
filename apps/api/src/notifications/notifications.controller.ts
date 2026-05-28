import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBooleanString,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

class ListNotificationsQuery {
  // Pass `?unread=true` (string, NOT a boolean) — Nest's query parser keeps
  // these as strings. The decorator validates the shape; we coerce below.
  @IsOptional()
  @IsBooleanString()
  unread?: string;
}

class MarkReadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids!: string[];
}

// Recipient-facing inbox API. RLS on `notifications` already scopes SELECT
// and UPDATE to "rows whose user_id = current_user", so the app-level filter
// (user_id = tenant.userId in every WHERE) is belt-and-suspenders: it keeps
// the queries cheap (uses idx_notifications_user_created) and gives a clear
// error path if a future migration accidentally relaxes the policy.
@Controller('notifications')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class NotificationsController {
  // GET /notifications?unread=true
  //   Newest-first. expires_at filter applied at read time (can't be in the
  //   index predicate — `now()` isn't IMMUTABLE).
  @Get()
  async list(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: ListNotificationsQuery,
  ) {
    const unreadOnly = q.unread === 'true';
    const where: Prisma.NotificationWhereInput = {
      userId: tenant.userId,
      expiresAt: { gt: new Date() },
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const items = await db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return { items, unreadCount: await this.unreadCount(db, tenant.userId) };
  }

  // POST /notifications/mark-read  body: { ids: string[] }
  //   Idempotent — already-read rows update read_at to "now" again only if
  //   they were still null. Returns the actual count touched.
  @Post('mark-read')
  @HttpCode(200)
  async markRead(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: MarkReadDto,
  ) {
    const result = await db.notification.updateMany({
      where: { id: { in: dto.ids }, userId: tenant.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count, unreadCount: await this.unreadCount(db, tenant.userId) };
  }

  // POST /notifications/mark-all-read
  //   Sweep: any still-unread row for the caller, flipped to read.
  @Post('mark-all-read')
  @HttpCode(200)
  async markAllRead(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const result = await db.notification.updateMany({
      where: { userId: tenant.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count, unreadCount: 0 };
  }

  private async unreadCount(db: Prisma.TransactionClient, userId: string) {
    return db.notification.count({
      where: { userId, readAt: null, expiresAt: { gt: new Date() } },
    });
  }
}
