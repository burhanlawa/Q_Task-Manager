import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import Stripe from 'stripe';
// Type-only import for the namespace (Stripe.Event etc). `stripe`'s
// CJS `export =` shape doesn't surface the namespace through the
// default import, so we pull it from the .d.ts path for types only.
// The runtime value lives on the default export (`Stripe.webhooks`).
import type { Stripe as StripeNS } from 'stripe/esm/stripe.core';
import { StripeWebhookService } from './stripe-webhook.service';

// TS can see Stripe.webhooks as a static but only through the inner
// class type. The default import is callable + has the statics, but
// the typeof shape narrows them away. Cast to the runtime class type.
const StripeStatics = Stripe as unknown as {
  webhooks: {
    constructEvent: (body: string | Buffer, sig: string, secret: string) => StripeNS.Event;
  };
};

// Sprint 20.3 — Stripe webhook receiver.
//
// Mirrors the 19.6 Paddle controller's shape: SkipThrottle so retries
// aren't dropped, raw body required for signature verification, 200 OK
// on both fresh and duplicate events.
//
// We use Stripe's official webhooks.constructEvent() rather than
// hand-rolling HMAC like the Paddle controller does — Stripe's
// Stripe-Signature header has its own format (t=<ts>,v1=<hex>) and
// their helper bundles the parse + verify + replay window in one call.
// The 'stripe' SDK exposes this as a static method so we don't need a
// configured client instance just for the verify step.

@Controller('webhooks/stripe')
@SkipThrottle()
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(private readonly service: StripeWebhookService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true; processed: boolean }> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event: StripeNS.Event;
    try {
      event = StripeStatics.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch (err) {
      this.log.warn(`Stripe signature verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid stripe signature');
    }

    const result = await this.service.handle(event);
    return { received: true, processed: result.processed };
  }
}
