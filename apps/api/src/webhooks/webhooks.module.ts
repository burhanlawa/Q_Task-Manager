import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';
import { PaddleWebhookController } from './paddle-webhook.controller';
import { PaddleWebhookService } from './paddle-webhook.service';

@Module({
  controllers: [ClerkWebhookController, PaddleWebhookController],
  providers: [ClerkWebhookService, PaddleWebhookService],
})
export class WebhooksModule {}
