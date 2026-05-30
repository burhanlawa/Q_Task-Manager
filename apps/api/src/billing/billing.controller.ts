import { Controller, ForbiddenException, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { isUnlimitedUsers, limitsFor } from './plan-limits';

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
    seats: { used: number; limit: number; unlimited: boolean };
    storage: { usedBytes: string; limitBytes: string; unlimited: boolean };
  }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can view billing');
    }

    // Run the three reads in parallel — subscription state + the two
    // usage signals the page renders alongside it (seat count and
    // storage). All three are RLS-scoped to this tenant.
    const [sub, company, seatCount, activeUserCount] = await Promise.all([
      db.subscription.findUnique({
        where: { companyId: tenant.companyId },
        select: {
          plan: true,
          status: true,
          billingCycle: true,
          trialEndAt: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      }),
      db.company.findUnique({
        where: { id: tenant.companyId },
        select: { plan: true, storageUsedBytes: true },
      }),
      // Paid-user count for the seat gauge. "active or invited" matches
      // the rule PlanLimitsService.assertCanAddUser enforces — an invited
      // user occupies a seat from the moment the invite goes out.
      db.user.count({
        where: {
          companyId: tenant.companyId,
          deletedAt: null,
          status: { in: ['active', 'invited'] },
        },
      }),
      // Active-only count drives the growth tier's "+1 GB / active user"
      // storage limit. PlanLimitsService uses the same query shape.
      db.user.count({
        where: { companyId: tenant.companyId, status: 'active', deletedAt: null },
      }),
    ]);

    // Defensive default for the subscription row. The 19.1 backfill
    // seeded every existing tenant, but if something somehow deletes
    // it we don't want the page to crash — fall back to a starter trial.
    const subResolved = sub ?? {
      plan: 'starter' as const,
      status: 'trialing' as const,
      billingCycle: 'monthly' as const,
      trialEndAt: null as Date | null,
      currentPeriodEnd: null as Date | null,
      cancelAtPeriodEnd: false,
    };
    const planForLimits = company?.plan ?? subResolved.plan;
    const limits = limitsFor(planForLimits);
    const storageLimit = limits.storageBytes(activeUserCount);
    const storageUsed = company?.storageUsedBytes ?? BigInt(0);

    return {
      plan: subResolved.plan,
      status: subResolved.status,
      billingCycle: subResolved.billingCycle,
      trialEndAt: subResolved.trialEndAt?.toISOString() ?? null,
      currentPeriodEnd: subResolved.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subResolved.cancelAtPeriodEnd,
      seats: {
        used: seatCount,
        limit: limits.maxUsers,
        unlimited: isUnlimitedUsers(limits.maxUsers),
      },
      storage: {
        usedBytes: storageUsed.toString(),
        limitBytes: storageLimit.toString(),
        // Enterprise uses MAX_SAFE_INTEGER as the sentinel; the web side
        // shouldn't render a literal "8.99 petabytes" — it should say
        // "Unlimited." Same convention as the seats limit.
        unlimited: storageLimit >= BigInt(Number.MAX_SAFE_INTEGER),
      },
    };
  }
}
