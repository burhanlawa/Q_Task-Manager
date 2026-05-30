import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';
import { PaddleWebhookController } from './paddle-webhook.controller';
import { PaddleWebhookService } from './paddle-webhook.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  controllers: [ClerkWebhookController, PaddleWebhookController, StripeWebhookController],
  providers: [ClerkWebhookService, PaddleWebhookService, StripeWebhookService],
})
export class WebhooksModule {}
