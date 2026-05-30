import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
// stripe v22 ships the namespace via a separate path. The default
// export from 'stripe' is just the constructor; the merged
// Stripe.Event / Stripe.Subscription / etc. type namespace lives in
// 'stripe/esm/stripe.core'. We never instantiate this — it's pure
// types — so the runtime cost is zero.
import type { Stripe } from 'stripe/esm/stripe.core';

// Sprint 20.3 — Stripe webhook business logic.
//
// Mirrors the Sprint 19.6 Paddle handler: idempotent INSERT into the
// stripe_webhook_events log, then a switch on event.type dispatching
// to the right local state transition. Connects with DATABASE_URL
// (owner role) since the webhook has no tenant context — companyId
// flows in from session/subscription metadata.
//
// Event scope (Sprint 20.3):
//   customer.subscription.created    → activate / set ids + period
//   customer.subscription.updated    → re-sync (active / past_due /
//                                      paused / cancel_at_period_end)
//   customer.subscription.deleted    → cancel
//   invoice.paid                     → INSERT invoice (paid)
//   invoice.payment_failed           → status='past_due'
//   checkout.session.completed       → fallback resolve when ids land
//                                      before the subscription.* events
//
// We always sync companies.plan + companies.status (denormalized cache
// for the admin dashboard) within the same transaction as the
// subscriptions update. Drift between the two surfaces as silent bugs.

type StripeSubscription = Stripe.Subscription;
type StripeInvoice = Stripe.Invoice;
type StripeCheckoutSession = Stripe.Checkout.Session;

@Injectable()
export class StripeWebhookService {
  private readonly log = new Logger(StripeWebhookService.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  async handle(event: Stripe.Event): Promise<{ processed: boolean }> {
    // Idempotency. INSERT first; P2002 on the event_id PK means we've
    // already seen this delivery (Stripe retries on non-2xx).
    try {
      await this.db.stripeWebhookEvent.create({
        data: { eventId: event.id, eventType: event.type },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.log.debug(`Duplicate stripe event ${event.id}; skipping.`);
        return { processed: false };
      }
      throw err;
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.onSubscriptionUpserted(event.data.object as StripeSubscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as StripeSubscription);
        break;
      case 'invoice.paid':
        await this.onInvoicePaid(event.data.object as StripeInvoice);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event.data.object as StripeInvoice);
        break;
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event.data.object as StripeCheckoutSession);
        break;
      default:
        // Stripe sends a lot of event types — we ack + ignore to keep
        // their retry loop quiet. The full list is configurable in
        // the Stripe dashboard; only the ones above need processing.
        this.log.debug(`Ignoring stripe event ${event.type}`);
    }
    return { processed: true };
  }

  // ----- handlers ----------------------------------------------------

  private async onSubscriptionUpserted(sub: StripeSubscription): Promise<void> {
    const companyId = readCompanyId(sub.metadata);
    const target = await this.findSubscription(sub.id, companyId);
    if (!target) {
      this.log.warn(
        `subscription.${sub.status}: no local subscription for stripe_id=${sub.id} companyId=${companyId ?? '?'}`,
      );
      return;
    }

    const localStatus = this.mapStripeStatus(sub.status);
    const plan = localStatus === 'active' ? this.upgradePlan(target.plan) : target.plan;
    // In the 2026-05-27 API the period moved off the Subscription to
    // each SubscriptionItem. Our subs are single-item (Pro), so we read
    // the first item — if Stripe ever ships a sub with no items we
    // fall back to nulls rather than crash the handler.
    const firstItem = sub.items?.data?.[0] ?? null;
    const periodStart = secondsToDate(firstItem?.current_period_start);
    const periodEnd = secondsToDate(firstItem?.current_period_end);

    // Past-due lifecycle bookkeeping (Sprint 20.6):
    //   - transitioning TO past_due: stamp past_due_at (setOnce so the
    //     ladder doesn't reset on subsequent retries).
    //   - transitioning OUT (anything not past_due): clear all the
    //     ladder fields + companies.read_only_at so recovery is clean.
    const pastDueFields =
      localStatus === 'past_due'
        ? { pastDueAt: target.pastDueAt ?? new Date() }
        : {
            pastDueAt: null,
            pastDueWarningSentAt: null,
            deletionEnqueuedAt: null,
          };
    const companyExtras = localStatus === 'past_due' ? {} : { readOnlyAt: null };

    await this.db.$transaction([
      this.db.subscription.update({
        where: { id: target.id },
        data: {
          status: localStatus,
          plan,
          paymentProvider: 'stripe',
          stripeSubscriptionId: sub.id,
          stripeCustomerId:
            typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null),
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
          ...pastDueFields,
        },
      }),
      this.db.company.update({
        where: { id: target.companyId },
        data: { status: localStatus, plan, ...companyExtras },
      }),
    ]);
    this.log.log(
      `subscription.${sub.status}: company=${target.companyId} → status=${localStatus} plan=${plan}`,
    );
  }

  private async onSubscriptionDeleted(sub: StripeSubscription): Promise<void> {
    const companyId = readCompanyId(sub.metadata);
    const target = await this.findSubscription(sub.id, companyId);
    if (!target) return;
    await this.db.$transaction([
      this.db.subscription.update({
        where: { id: target.id },
        data: { status: 'cancelled', cancelAtPeriodEnd: false },
      }),
      this.db.company.update({
        where: { id: target.companyId },
        data: { status: 'cancelled' },
      }),
    ]);
    this.log.log(`subscription.deleted: company=${target.companyId} → status=cancelled`);
  }

  private async onInvoicePaid(invoice: StripeInvoice): Promise<void> {
    // In the 2026-05-27 Stripe API the subscription association moved
    // under invoice.parent.subscription_details. We read the linked
    // subscription id from there, and fall back to metadata for
    // companyId (set by checkout.sessions.create in 20.2).
    const { subscriptionId, companyId } = extractInvoiceParent(invoice);
    const target = await this.findSubscription(subscriptionId, companyId);
    if (!target) {
      this.log.warn(
        `invoice.paid: no local subscription for stripe_sub=${subscriptionId ?? '?'} companyId=${companyId ?? '?'}`,
      );
      return;
    }

    const amountCents = typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;
    const currency = (invoice.currency ?? 'usd').toUpperCase();
    const periodStart = invoice.period_start ? secondsToDate(invoice.period_start) : null;
    const periodEnd = invoice.period_end ? secondsToDate(invoice.period_end) : null;

    try {
      await this.db.invoice.create({
        data: {
          companyId: target.companyId,
          subscriptionId: target.id,
          stripeInvoiceId: invoice.id,
          paymentProvider: 'stripe',
          paymentMethod: 'card',
          amountCents,
          currency,
          status: 'paid',
          billedAt: invoice.created ? secondsToDate(invoice.created) : new Date(),
          periodStart,
          periodEnd,
        },
      });
      this.log.log(
        `invoice.paid: invoice for company=${target.companyId} stripe_inv=${invoice.id} amount=${amountCents} ${currency}`,
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.log.debug(`Duplicate invoice for stripe_inv=${invoice.id}; skipping.`);
        return;
      }
      throw err;
    }
  }

  private async onInvoicePaymentFailed(invoice: StripeInvoice): Promise<void> {
    const { subscriptionId, companyId } = extractInvoiceParent(invoice);
    const target = await this.findSubscription(subscriptionId, companyId);
    if (!target) return;
    // setOnce semantics — leave past_due_at alone if it's already set
    // so the Sprint 20.6 ladder doesn't reset on each retry.
    const stampPastDueAt = target.pastDueAt ?? new Date();
    await this.db.$transaction([
      this.db.subscription.update({
        where: { id: target.id },
        data: { status: 'past_due', pastDueAt: stampPastDueAt },
      }),
      this.db.company.update({
        where: { id: target.companyId },
        data: { status: 'past_due' },
      }),
    ]);
    this.log.warn(
      `invoice.payment_failed: company=${target.companyId} → status=past_due (Sprint 20.7 ladder pending)`,
    );
  }

  // checkout.session.completed fires before customer.subscription.created
  // in some Stripe flows. We use it as a fallback to stamp the ids
  // early — if the subscription.* event arrives second it'll find the
  // row by stripe_subscription_id and skip the metadata lookup.
  private async onCheckoutSessionCompleted(session: StripeCheckoutSession): Promise<void> {
    const companyId = readCompanyId(session.metadata);
    if (!companyId) return;
    const stripeSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);
    if (!stripeSubscriptionId) return;
    const target = await this.findSubscription(stripeSubscriptionId, companyId);
    if (!target) return;
    // Don't flip status here — the subscription.* event is authoritative
    // for status. Just stamp the ids so the next webhook is fast-path.
    if (!target.paddleCustomerId && !target.stripeCustomerId) {
      await this.db.subscription.update({
        where: { id: target.id },
        data: {
          stripeSubscriptionId,
          stripeCustomerId:
            typeof session.customer === 'string'
              ? session.customer
              : (session.customer?.id ?? null),
          paymentProvider: 'stripe',
        },
      });
    }
  }

  // ----- helpers -----------------------------------------------------

  // Resolve the local subscriptions row. Try stripe_subscription_id
  // first (set on every event after the first activation), then fall
  // back to companyId from metadata (first activation case).
  private async findSubscription(
    stripeSubscriptionId: string | null,
    companyId: string | null,
  ): Promise<{
    id: string;
    companyId: string;
    plan: 'starter' | 'growth' | 'enterprise';
    paddleCustomerId: string | null;
    stripeCustomerId: string | null;
    pastDueAt: Date | null;
  } | null> {
    const selectShape = {
      id: true,
      companyId: true,
      plan: true,
      paddleCustomerId: true,
      stripeCustomerId: true,
      pastDueAt: true,
    } as const;
    if (stripeSubscriptionId) {
      const byStripeId = await this.db.subscription.findUnique({
        where: { stripeSubscriptionId },
        select: selectShape,
      });
      if (byStripeId) return byStripeId;
    }
    if (companyId) {
      const byCompany = await this.db.subscription.findUnique({
        where: { companyId },
        select: selectShape,
      });
      if (byCompany) return byCompany;
    }
    return null;
  }

  // Stripe statuses → our subscription_status enum. We collapse states
  // we don't model (incomplete / incomplete_expired) into the nearest
  // local meaning rather than throwing — the dashboard tells the rest
  // of the story.
  private mapStripeStatus(
    status: Stripe.Subscription.Status,
  ): 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' {
    switch (status) {
      case 'trialing':
        return 'trialing';
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'paused':
        return 'paused';
      case 'canceled':
        return 'cancelled';
      case 'unpaid':
        return 'past_due';
      case 'incomplete':
      case 'incomplete_expired':
        // Subscription created but first payment never confirmed.
        // Closest local meaning: still in trialing/limbo. The
        // subsequent activated event flips this to active.
        return 'trialing';
      default:
        return 'active';
    }
  }

  // Pro is the only paid tier we ship in Sprint 19/20. Once the
  // subscription is anything-active (trialing or active) we treat that
  // as growth; enterprise upgrades happen via a different path that
  // isn't through self-serve checkout.
  private upgradePlan(current: string): 'starter' | 'growth' | 'enterprise' {
    if (current === 'enterprise') return 'enterprise';
    return 'growth';
  }
}

// Stripe API 2026-05-27 moved invoice→subscription under
// invoice.parent.subscription_details. We pull both the subscription id
// and the snapshot metadata (which is the only place the original
// checkout's companyId survives on a renewal invoice — Stripe doesn't
// propagate Invoice.metadata from the parent subscription).
function extractInvoiceParent(invoice: Stripe.Invoice): {
  subscriptionId: string | null;
  companyId: string | null;
} {
  const subDetails = invoice.parent?.subscription_details ?? null;
  const subRef = subDetails?.subscription ?? null;
  const subscriptionId = typeof subRef === 'string' ? subRef : (subRef?.id ?? null);
  const companyId = readCompanyId(invoice.metadata) ?? readCompanyId(subDetails?.metadata);
  return { subscriptionId, companyId };
}

function secondsToDate(seconds: number | null | undefined): Date | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

function readCompanyId(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const m = metadata as Record<string, unknown>;
  return typeof m.companyId === 'string' ? m.companyId : null;
}
