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
// The 'stripe' default export is the constructor proxy; TypeScript
// loses the static `webhooks` member through that path. Import the
// class itself from stripe.core so .webhooks.constructEvent() is
// callable, and the namespace from the same path for the Event type.
import { Stripe, type Stripe as StripeNS } from 'stripe/esm/stripe.core';
import { StripeWebhookService } from './stripe-webhook.service';

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
      event = Stripe.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch (err) {
      this.log.warn(`Stripe signature verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid stripe signature');
    }

    const result = await this.service.handle(event);
    return { received: true, processed: result.processed };
  }
}
