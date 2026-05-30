import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';

// The stripe package uses CJS `export =`, so `Stripe` is callable as a
// constructor but the nested instance type only surfaces via
// InstanceType<>. Alias it once for readability.
type StripeClient = InstanceType<typeof Stripe>;

// Sprint 20.2 — Stripe Checkout Session creation.
//
// Mirror of the Paddle.js inline-checkout flow, but server-driven:
// Stripe Checkout requires a Session created with our secret key,
// then the browser is redirected to Stripe's hosted page. We attach
// metadata: { companyId } so the Sprint 20.3 webhook handler can
// resolve back to our tenant — same role customData plays for Paddle.
//
// Boots lazily: if STRIPE_SECRET_KEY isn't set we don't construct the
// client at all, and createCheckoutSession() throws a 503. This lets
// the API boot without Stripe credentials (matching how we ship the
// Paddle path while merchant access is blocked from Iraq) and the
// /billing/upgrade page degrades gracefully with the same "not
// configured" panel pattern.

type CycleId = 'monthly' | 'annual';

@Injectable()
export class StripeCheckoutService {
  private readonly log = new Logger(StripeCheckoutService.name);
  private client: StripeClient | null = null;

  private getClient(): StripeClient {
    if (this.client) return this.client;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'Stripe is not configured on this deployment (STRIPE_SECRET_KEY missing).',
      );
    }
    // Pin an API version so server/runtime upgrades don't silently
    // change Stripe's response shapes under us. Bump intentionally.
    this.client = new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_PRO_PRICE_MONTHLY &&
      process.env.STRIPE_PRO_PRICE_ANNUAL,
    );
  }

  async createCheckoutSession(input: {
    companyId: string;
    cycle: CycleId;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string | null;
  }): Promise<{ url: string; sessionId: string }> {
    const priceMonthly = process.env.STRIPE_PRO_PRICE_MONTHLY;
    const priceAnnual = process.env.STRIPE_PRO_PRICE_ANNUAL;
    if (!priceMonthly || !priceAnnual) {
      throw new ServiceUnavailableException(
        'Stripe price IDs are not configured (STRIPE_PRO_PRICE_* env vars missing).',
      );
    }
    const price = input.cycle === 'annual' ? priceAnnual : priceMonthly;

    const session = await this.getClient().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail ?? undefined,
      // Metadata flows back through the webhook in
      // checkout.session.completed.data.object.metadata. Sprint 20.3
      // resolves the local subscription row from companyId.
      metadata: { companyId: input.companyId },
      // Same metadata gets stamped onto the created Subscription so
      // customer.subscription.created carries it too.
      subscription_data: {
        metadata: { companyId: input.companyId },
      },
      // Tax — leave to Stripe Tax once enabled in dashboard. Default
      // off so the test path doesn't fail on missing tax config.
      automatic_tax: { enabled: false },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      // Shouldn't happen for mode: 'subscription' but typescript wants
      // the narrow check and we'd rather 502 than redirect to null.
      this.log.error(`Stripe session ${session.id} returned no URL`);
      throw new ServiceUnavailableException('Stripe did not return a checkout URL');
    }
    return { url: session.url, sessionId: session.id };
  }
}
