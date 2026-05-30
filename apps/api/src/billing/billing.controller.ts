import { Controller, ForbiddenException, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

// Sprint 19.5 — /billing/me feeds the /billing and /billing/upgrade pages.
// CEO/Admin only because the page exposes plan + trial state + cancel
// intent — same gate as the admin dashboard subscription card.
//
// Reads from the subscriptions table (source of truth from Sprint 19.1);
// the companies.plan / companies.status denormalized cache is updated by
// the Sprint 19.2 lifecycle scheduler and 19.6 webhook handler.

const ADMIN_TIER_ROLES = new Set(['ceo', 'admin']);

@Controller('billing')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class BillingController {
  @Get('me')
  async me(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{
    plan: string;
    status: string;
    billingCycle: string;
    trialEndAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can view billing');
    }
    const sub = await db.subscription.findUnique({
      where: { companyId: tenant.companyId },
      select: {
        plan: true,
        status: true,
        billingCycle: true,
        trialEndAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });
    // Defensive default. The 19.1 backfill seeded every existing tenant
    // with a row, but if something somehow deletes it we don't want the
    // page to crash — fall back to "trialing starter, no Paddle yet."
    if (!sub) {
      return {
        plan: 'starter',
        status: 'trialing',
        billingCycle: 'monthly',
        trialEndAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
    }
    return {
      plan: sub.plan,
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndAt: sub.trialEndAt?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
}
