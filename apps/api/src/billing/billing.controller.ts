import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SkipBillingGate } from '../auth/billing-status.guard';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { BankTransferService } from './bank-transfer.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { isUnlimitedUsers, limitsFor, type PlanKey } from './plan-limits';
import { PlanLimitsService } from './plan-limits.service';
import { pickCheckoutProvider, type CheckoutProvider } from './provider-routing';
import { StripeCheckoutService } from './stripe-checkout.service';

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
// Every endpoint on this controller is part of the recovery flow —
// a tenant in read-only state must still be able to create a checkout
// session, submit a transfer reference, and download their invoice.
// Sprint 20.7's BillingStatusGuard would otherwise 402 these.
@SkipBillingGate()
export class BillingController {
  constructor(
    private readonly stripeCheckout: StripeCheckoutService,
    private readonly bankTransfer: BankTransferService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly planLimits: PlanLimitsService,
  ) {}

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
    checkoutProvider: CheckoutProvider;
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
        select: { plan: true, storageUsedBytes: true, country: true },
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
      // Sprint 20.2 — which checkout component the upgrade page should
      // mount for this tenant. Paddle (primary) for most countries;
      // Stripe (fallback) when Paddle doesn't onboard the geo. Lives
      // in /billing/me so the web side doesn't have to embed the
      // routing rules — they stay server-authoritative.
      checkoutProvider: pickCheckoutProvider(company?.country),
    };
  }

  // POST /billing/checkout/stripe
  //   Creates a Stripe Checkout Session and returns its hosted URL so
  //   the browser can window.location to it. Session metadata carries
  //   companyId so the Sprint 20.3 webhook can resolve the tenant.
  //   CEO/Admin only — same gate as /billing/me.
  @Post('checkout/stripe')
  async createStripeCheckout(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() body: { cycle?: 'monthly' | 'annual'; returnOrigin?: string },
  ): Promise<{ url: string; sessionId: string }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, email: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can start a checkout');
    }
    const cycle: 'monthly' | 'annual' = body?.cycle === 'annual' ? 'annual' : 'monthly';
    // returnOrigin comes from the browser (window.location.origin). We
    // could derive from a server-side env var, but in dev the API may
    // run under a different host than the web app, and a wrong origin
    // sends the user to a 404 after payment. We trust this only to
    // build success/cancel URLs — Stripe re-validates redirects.
    const origin = typeof body?.returnOrigin === 'string' ? body.returnOrigin : '';
    if (!/^https?:\/\//.test(origin)) {
      throw new BadRequestException('returnOrigin must be an http(s) URL');
    }
    return this.stripeCheckout.createCheckoutSession({
      companyId: tenant.companyId,
      cycle,
      successUrl: `${origin}/billing?success=1`,
      cancelUrl: `${origin}/billing/upgrade?canceled=1`,
      customerEmail: me.email,
    });
  }

  // GET /billing/bank-details
  //   Returns the bank coordinates the customer should wire to. Driven
  //   by BANK_TRANSFER_* env vars so the operator can swap accounts
  //   without a deploy. configured=false means the upgrade page should
  //   hide the bank-transfer option entirely. Any signed-in user can
  //   read this (CEO/Admin gate is on /checkout/bank-transfer below).
  @Get('bank-details')
  async bankDetails(): Promise<ReturnType<BankTransferService['getBankDetails']>> {
    return this.bankTransfer.getBankDetails();
  }

  // GET /billing/pending-invoice
  //   Returns the tenant's outstanding manual bank-transfer invoice if
  //   any, so the /billing and /billing/upgrade pages can show the
  //   "submit your reference" form. Returns null if there isn't one.
  @Get('pending-invoice')
  async pendingInvoice(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{
    id: string;
    amountCents: number;
    currency: string;
    paymentReference: string | null;
    issuedAt: string;
  } | null> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can view pending invoices');
    }
    const invoice = await db.invoice.findFirst({
      where: {
        companyId: tenant.companyId,
        paymentMethod: 'bank_transfer',
        status: 'open',
      },
      select: {
        id: true,
        amountCents: true,
        currency: true,
        paymentReference: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!invoice) return null;
    return {
      id: invoice.id,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      paymentReference: invoice.paymentReference,
      issuedAt: invoice.createdAt.toISOString(),
    };
  }

  // POST /billing/checkout/bank-transfer
  //   CEO/Admin requests a bank-transfer invoice. Creates a single
  //   status='open' row; the customer then wires the money and posts
  //   the reference via PATCH /billing/invoices/:id/reference.
  @Post('checkout/bank-transfer')
  async createBankTransferInvoice(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{ id: string; amountCents: number; currency: string }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can start a checkout');
    }
    return this.bankTransfer.createPendingInvoice(db, {
      companyId: tenant.companyId,
      userId: tenant.userId,
    });
  }

  // PATCH /billing/invoices/:id/reference
  //   Customer posts their wire transfer reference (or FastPay txn,
  //   etc). Idempotent — re-posting overwrites. CEO/Admin only because
  //   /billing is admin-only anyway.
  @Patch('invoices/:id/reference')
  async submitTransferReference(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: { reference?: string },
  ): Promise<{ ok: true }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can submit a payment reference');
    }
    if (typeof body?.reference !== 'string') {
      throw new BadRequestException('reference must be a string');
    }
    await this.bankTransfer.submitReference(db, {
      companyId: tenant.companyId,
      invoiceId,
      reference: body.reference,
    });
    return { ok: true };
  }

  // POST /billing/invoices/:id/mark-paid
  //   PLATFORM operator endpoint. Gated by 'platform.billing.review',
  //   which no built-in role has — manually grant it to QTM staff via
  //   /admin/roles or a direct user-permission grant. The endpoint
  //   does NOT use the tenant interceptor's RLS-scoped Prisma client
  //   on purpose: the operator needs to update invoices and
  //   subscriptions across tenant boundaries, so we rely entirely on
  //   the permission gate. Records actor on the invoice row.
  @Post('invoices/:id/mark-paid')
  @RequirePermissions('platform.billing.review')
  async markInvoicePaid(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<{ id: string; status: 'paid' }> {
    return this.bankTransfer.markPaid({
      invoiceId,
      markerUserId: tenant.userId,
    });
  }

  // GET /billing/invoices/:id/pdf
  //   Downloads the invoice as PDF. Lazy-generates on first hit (sets
  //   pdf_r2_key on the row), then re-uses the R2 object for every
  //   subsequent request. CEO/Admin only — same gate as the rest of
  //   /billing. The RLS-scoped Prisma client makes sure a tenant can
  //   only fetch their own invoices; ensurePdf double-checks via the
  //   companyId filter.
  @Get('invoices/:id/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadInvoice(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<StreamableFile> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can download invoices');
    }
    const key = await this.invoicePdf.ensurePdf(db, invoiceId, tenant.companyId);
    const bytes = await this.invoicePdf.getPdfBytes(key);
    return new StreamableFile(bytes, {
      disposition: `attachment; filename="invoice-${invoiceId.slice(0, 8)}.pdf"`,
    });
  }

  // POST /billing/downgrade { targetPlan: 'starter' | 'growth' | 'enterprise' }
  //   Local plan downgrade gate. Validates that current usage fits the
  //   target plan's seat + storage limits; if not, throws 422 with a
  //   structured `blockers` list so the web can render a "remove N
  //   users / N GB" list. If validation passes, flips the local plan
  //   and syncs the companies cache.
  //
  //   NOTE: this does NOT cancel a paid Paddle/Stripe subscription. If
  //   the tenant has paddleSubscriptionId or stripeSubscriptionId set,
  //   we refuse — the cancellation has to go through the provider
  //   first so we don't leave them paying for a tier we've downgraded
  //   them off of locally. Once the webhook fires
  //   subscription.canceled / customer.subscription.deleted, the plan
  //   becomes downgradeable through this endpoint.
  @Post('downgrade')
  async downgrade(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() body: { targetPlan?: string },
  ): Promise<{ plan: PlanKey }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true },
    });
    if (!me || !ADMIN_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Only CEO/Admin can change the plan');
    }

    const targetPlan = body?.targetPlan;
    if (targetPlan !== 'starter' && targetPlan !== 'growth' && targetPlan !== 'enterprise') {
      throw new BadRequestException('targetPlan must be one of: starter, growth, enterprise');
    }

    const sub = await db.subscription.findUnique({
      where: { companyId: tenant.companyId },
      select: {
        id: true,
        plan: true,
        paddleSubscriptionId: true,
        stripeSubscriptionId: true,
      },
    });
    if (!sub) throw new ForbiddenException('Subscription row missing for this tenant');

    if (sub.plan === targetPlan) {
      // No-op; already on this plan. Treat as success so a double-click
      // doesn't surface as a 4xx.
      return { plan: targetPlan };
    }

    // Refuse local downgrade while an external provider subscription is
    // still active — the provider has to cancel first or the customer
    // ends up paying for a plan they don't have.
    if (sub.paddleSubscriptionId || sub.stripeSubscriptionId) {
      throw new UnprocessableEntityException({
        message:
          'Cancel your subscription with the payment provider first. Once the cancellation webhook arrives we can downgrade the local plan.',
        code: 'provider_subscription_active',
        provider: sub.paddleSubscriptionId ? 'paddle' : 'stripe',
      });
    }

    // The actual gate. Throws 422 with the blockers list if usage
    // exceeds the target plan's limits.
    await this.planLimits.assertCanDowngrade(db, tenant.companyId, targetPlan);

    // Already inside the TenantContextInterceptor's transaction, so
    // these two writes commit atomically with the rest of the request.
    await db.subscription.update({ where: { id: sub.id }, data: { plan: targetPlan } });
    await db.company.update({ where: { id: tenant.companyId }, data: { plan: targetPlan } });
    return { plan: targetPlan };
  }
}
