import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { UpdateMeDto } from './dto/update-me.dto';

const ME_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  phone: true,
  avatarFileId: true,
  locale: true,
  timezone: true,
  orgRole: true,
  status: true,
  employmentStatus: true,
  companyId: true,
  branchId: true,
  departmentId: true,
  dateOfBirth: true, // sensitive in general, but reading your own DOB is fine + not audited
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
  onboardingCompletedAt: true,
  lastLoginAt: true,
  company: { select: { id: true, name: true, slug: true, status: true, country: true } },
} satisfies Prisma.UserSelect;

@Controller('me')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * Diagnostic-only: returns whether the caller's effective-permissions set
   * is cached and the total cache size. Used to verify the 5-minute TTL works
   * (Sprint 6 task 6.7's done check). Gated behind role.manage so casual
   * users can't probe cache state; admins can keep using it.
   */
  @Get('permissions-debug')
  @RequirePermissions('role.manage')
  permissionsDebug(@CurrentTenant() tenant: TenantContext) {
    return {
      userId: tenant.userId,
      isCached: this.permissions.isCached(tenant.userId),
      cacheSize: this.permissions.cacheSize(),
    };
  }

  @Get()
  async profile(@CurrentTenant() tenant: TenantContext, @TenantDb() db: Prisma.TransactionClient) {
    const user = await db.user.findUnique({
      where: { id: tenant.userId },
      select: ME_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Patch()
  async update(
    @CurrentTenant() tenant: TenantContext,
    @TenantDb() db: Prisma.TransactionClient,
    @Body() dto: UpdateMeDto,
  ) {
    // Self-edit endpoint: every authenticated user can call this. The DTO's
    // class-validator whitelist (and main.ts's forbidNonWhitelisted) means
    // unknown fields like `orgRole` are rejected with 400 — the user can't
    // sneak organizational fields into the request.
    const data: Prisma.UserUncheckedUpdateManyInput = {};
    for (const k of [
      'firstName',
      'lastName',
      'displayName',
      'phone',
      'timezone',
      'address',
      'emergencyContactName',
      'emergencyContactPhone',
      'emergencyContactRelationship',
    ] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth === null ? null : new Date(dto.dateOfBirth);
    }

    const result = await db.user.updateMany({
      where: { id: tenant.userId, deletedAt: null },
      data,
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    return db.user.findUnique({ where: { id: tenant.userId }, select: ME_SELECT });
  }

  /**
   * Mark onboarding as completed (Sprint 7 task 7.5). Called either when the
   * user submits the full /onboarding/welcome form OR when they click "skip
   * for now." Idempotent — re-completing is a no-op since the timestamp
   * stays at the original time.
   */
  @Post('complete-onboarding')
  @HttpCode(200)
  async completeOnboarding(
    @CurrentTenant() tenant: TenantContext,
    @TenantDb() db: Prisma.TransactionClient,
  ): Promise<{ onboardingCompletedAt: string }> {
    const existing = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { onboardingCompletedAt: true },
    });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.onboardingCompletedAt) {
      return { onboardingCompletedAt: existing.onboardingCompletedAt.toISOString() };
    }
    const now = new Date();
    await db.user.update({
      where: { id: tenant.userId },
      data: { onboardingCompletedAt: now },
    });
    // Sprint 7 task 7.6 — log self-completion. Actor is the user themselves.
    await this.activity.recordOnboardingEvent({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      invitedUserId: tenant.userId,
      actionType: 'self_completed',
    });
    return { onboardingCompletedAt: now.toISOString() };
  }

  @Get('tenant')
  async tenant(
    @CurrentTenant() tenant: TenantContext,
    @TenantDb() db: Prisma.TransactionClient,
  ): Promise<{ companyId: string; rlsCompanyId: string | null }> {
    const rows = await db.$queryRaw<Array<{ v: string | null }>>`
      SELECT current_setting('app.current_company_id', true) AS v
    `;
    return { companyId: tenant.companyId, rlsCompanyId: rows[0]?.v ?? null };
  }
}
