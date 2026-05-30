import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// Sprint 19.6 — Paddle webhook business logic.
//
// We connect with DATABASE_URL (owner role) because the webhook handler
// has no tenant context. RLS would otherwise hide every row from the
// session. Tenant scoping is enforced by the resolve helpers — they
// look the company up via paddle_subscription_id or customData and we
// only ever touch that company's rows.
//
// Event scope (v2.0 — Sprint 19 scope; broader handling lands in 20):
//   subscription.activated     → status='active', cache plan/period/IDs
//   subscription.canceled      → status='cancelled', clear cancel intent
//   transaction.completed      → INSERT invoice (paid)
//   transaction.payment_failed → status='past_due' + activity-log event
//
// We always sync companies.plan + companies.status because the admin
// dashboard subscription card (Sprint 18.7) reads from the cache, and
// drift between source-of-truth and cache is the kind of bug that's
// invisible until a tenant complains.

export type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  data: Record<string, unknown>;
};

@Injectable()
export class PaddleWebhookService {
  private readonly log = new Logger(PaddleWebhookService.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  // Returns true if the event was processed, false if it was a duplicate
  // (idempotency hit). The controller maps both to 200 OK — Paddle only
  // cares that we acknowledged.
  async handle(event: PaddleEvent): Promise<{ processed: boolean }> {
    // 1. Idempotency. INSERT first; the unique constraint on event_id
    //    causes a second delivery to throw P2002 and fast-path back as
    //    "already processed."
    try {
      await this.db.paddleWebhookEvent.create({
        data: { eventId: event.event_id, eventType: event.event_type },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.log.debug(`Duplicate paddle event ${event.event_id}; skipping.`);
        return { processed: false };
      }
      throw err;
    }

    switch (event.event_type) {
      case 'subscription.activated':
        await this.onSubscriptionActivated(event.data);
        break;
      case 'subscription.canceled':
        await this.onSubscriptionCanceled(event.data);
        break;
      case 'transaction.completed':
        await this.onTransactionCompleted(event.data);
        break;
      case 'transaction.payment_failed':
        await this.onTransactionPaymentFailed(event.data);
        break;
      default:
        // Paddle delivers many event types we don't handle yet
        // (subscription.updated, subscription.past_due, address.created,
        //  etc.). We log + ack so Paddle's retry loop stays quiet.
        this.log.debug(`Ignoring paddle event ${event.event_type}`);
    }
    return { processed: true };
  }

  // ----- handlers ----------------------------------------------------

  private async onSubscriptionActivated(data: Record<string, unknown>): Promise<void> {
    const sub = this.resolveSubscriptionFields(data);
    if (!sub) return;
    const target = await this.findSubscription(sub.paddleSubscriptionId, sub.companyId);
    if (!target) {
      this.log.warn(
        `subscription.activated: no local subscription matched paddle_id=${sub.paddleSubscriptionId} companyId=${sub.companyId ?? '?'}`,
      );
      return;
    }
    const plan = this.mapPaddlePlanToLocal(data, target.plan);
    await this.db.$transaction([
      this.db.subscription.update({
        where: { id: target.id },
        data: {
          status: 'active',
          plan,
          paddleSubscriptionId: sub.paddleSubscriptionId,
          paddleCustomerId: sub.paddleCustomerId ?? target.paddleCustomerId,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: false,
        },
      }),
      this.db.company.update({
        where: { id: target.companyId },
        data: { status: 'active', plan },
      }),
    ]);
    this.log.log(
      `subscription.activated: company=${target.companyId} → status=active plan=${plan}`,
    );
  }

  private async onSubscriptionCanceled(data: Record<string, unknown>): Promise<void> {
    const sub = this.resolveSubscriptionFields(data);
    if (!sub) return;
    const target = await this.findSubscription(sub.paddleSubscriptionId, sub.companyId);
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
    this.log.log(`subscription.canceled: company=${target.companyId} → status=cancelled`);
  }

  private async onTransactionCompleted(data: Record<string, unknown>): Promise<void> {
    const txn = this.resolveTransactionFields(data);
    if (!txn) return;
    // We need a subscriptions row to attach the invoice to. Paddle's
    // transaction payload includes subscription_id for renewal txns.
    const target = await this.findSubscription(txn.paddleSubscriptionId, txn.companyId);
    if (!target) {
      this.log.warn(
        `transaction.completed: no local subscription matched paddle_id=${txn.paddleSubscriptionId} companyId=${txn.companyId ?? '?'}`,
      );
      return;
    }
    try {
      await this.db.invoice.create({
        data: {
          companyId: target.companyId,
          subscriptionId: target.id,
          paddleTransactionId: txn.paddleTransactionId,
          amountCents: txn.amountCents,
          currency: txn.currency,
          status: 'paid',
          billedAt: txn.billedAt ?? new Date(),
          periodStart: txn.periodStart,
          periodEnd: txn.periodEnd,
        },
      });
      this.log.log(
        `transaction.completed: invoice for company=${target.companyId} txn=${txn.paddleTransactionId} amount=${txn.amountCents} ${txn.currency}`,
      );
    } catch (err) {
      // Unique violation = same transaction re-delivered through a
      // different event id (Paddle sometimes splits txn.completed +
      // txn.billed for the same charge). Treat as a no-op.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.log.debug(`Duplicate invoice for txn=${txn.paddleTransactionId}; skipping.`);
        return;
      }
      throw err;
    }
  }

  private async onTransactionPaymentFailed(data: Record<string, unknown>): Promise<void> {
    const txn = this.resolveTransactionFields(data);
    if (!txn) return;
    const target = await this.findSubscription(txn.paddleSubscriptionId, txn.companyId);
    if (!target) return;
    // Past-due flow (blueprint §3.2 dunning ladder lives in Sprint 20).
    // For 19.6 we flip the status; 20 will layer email reminders, the
    // 7/14/30/120 day cascade, and final deletion on top.
    await this.db.$transaction([
      this.db.subscription.update({
        where: { id: target.id },
        data: { status: 'past_due' },
      }),
      this.db.company.update({
        where: { id: target.companyId },
        data: { status: 'past_due' },
      }),
    ]);
    this.log.warn(
      `transaction.payment_failed: company=${target.companyId} → status=past_due (Sprint 20 ladder pending)`,
    );
  }

  // ----- resolve helpers ---------------------------------------------

  private resolveSubscriptionFields(data: Record<string, unknown>): {
    paddleSubscriptionId: string | null;
    paddleCustomerId: string | null;
    companyId: string | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  } | null {
    const paddleSubscriptionId = typeof data.id === 'string' ? data.id : null;
    const paddleCustomerId = typeof data.customer_id === 'string' ? data.customer_id : null;
    const companyId = readCompanyIdFromCustomData(data.custom_data);
    const period = isRecord(data.current_billing_period) ? data.current_billing_period : null;
    const currentPeriodStart =
      period && typeof period.starts_at === 'string' ? new Date(period.starts_at) : null;
    const currentPeriodEnd =
      period && typeof period.ends_at === 'string' ? new Date(period.ends_at) : null;
    if (!paddleSubscriptionId && !companyId) return null;
    return {
      paddleSubscriptionId,
      paddleCustomerId,
      companyId,
      currentPeriodStart,
      currentPeriodEnd,
    };
  }

  private resolveTransactionFields(data: Record<string, unknown>): {
    paddleTransactionId: string;
    paddleSubscriptionId: string | null;
    companyId: string | null;
    amountCents: number;
    currency: string;
    billedAt: Date | null;
    periodStart: Date | null;
    periodEnd: Date | null;
  } | null {
    const paddleTransactionId = typeof data.id === 'string' ? data.id : null;
    if (!paddleTransactionId) return null;
    const paddleSubscriptionId =
      typeof data.subscription_id === 'string' ? data.subscription_id : null;
    const companyId = readCompanyIdFromCustomData(data.custom_data);
    const details = isRecord(data.details) ? data.details : null;
    const totals = details && isRecord(details.totals) ? details.totals : null;
    // Paddle ships totals.total as a string of minor units ("500" = $5.00).
    const amountCentsRaw = totals && typeof totals.total === 'string' ? totals.total : '0';
    const amountCents = Number.parseInt(amountCentsRaw, 10) || 0;
    const currency = typeof data.currency_code === 'string' ? data.currency_code : 'USD';
    const billedAt = typeof data.billed_at === 'string' ? new Date(data.billed_at) : null;
    const period = isRecord(data.billing_period) ? data.billing_period : null;
    const periodStart =
      period && typeof period.starts_at === 'string' ? new Date(period.starts_at) : null;
    const periodEnd =
      period && typeof period.ends_at === 'string' ? new Date(period.ends_at) : null;
    return {
      paddleTransactionId,
      paddleSubscriptionId,
      companyId,
      amountCents,
      currency,
      billedAt,
      periodStart,
      periodEnd,
    };
  }

  // Resolves to the local subscriptions row two ways:
  //  1. paddle_subscription_id (preferred — set once activated).
  //  2. companyId from customData (covers the first-activation case
  //     when our row doesn't have the paddle id stamped yet).
  private async findSubscription(
    paddleSubscriptionId: string | null,
    companyId: string | null,
  ): Promise<{
    id: string;
    companyId: string;
    plan: string;
    paddleCustomerId: string | null;
  } | null> {
    if (paddleSubscriptionId) {
      const byPaddleId = await this.db.subscription.findUnique({
        where: { paddleSubscriptionId },
        select: { id: true, companyId: true, plan: true, paddleCustomerId: true },
      });
      if (byPaddleId) return byPaddleId;
    }
    if (companyId) {
      const byCompany = await this.db.subscription.findUnique({
        where: { companyId },
        select: { id: true, companyId: true, plan: true, paddleCustomerId: true },
      });
      if (byCompany) return byCompany;
    }
    return null;
  }

  // Paddle's items carry price_id. Once we have NEXT_PUBLIC_PADDLE_PRICE_*
  // env vars wired we could map price_id → plan; for now we leave the
  // existing plan in place (or upgrade starter → growth on activate),
  // since Pro is the only paid tier in Sprint 19.
  private mapPaddlePlanToLocal(
    _data: Record<string, unknown>,
    current: string,
  ): 'starter' | 'growth' | 'enterprise' {
    if (current === 'enterprise') return 'enterprise';
    return 'growth';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readCompanyIdFromCustomData(custom: unknown): string | null {
  if (!isRecord(custom)) return null;
  return typeof custom.companyId === 'string' ? custom.companyId : null;
}
