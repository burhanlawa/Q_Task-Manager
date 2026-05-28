import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
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
  constructor(private readonly notifications: NotificationsService) {}

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
