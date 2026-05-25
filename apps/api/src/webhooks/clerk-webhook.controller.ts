import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { ClerkWebhookService } from './clerk-webhook.service';

type ClerkEvent = {
  type: string;
  data: Record<string, unknown>;
};

@Controller('webhooks/clerk')
export class ClerkWebhookController {
  constructor(private readonly service: ClerkWebhookService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ): Promise<{ received: true }> {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) throw new Error('CLERK_WEBHOOK_SECRET is required');

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException('Missing svix headers');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event: ClerkEvent;
    try {
      event = new Webhook(secret).verify(req.rawBody.toString('utf8'), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkEvent;
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    if (event.type === 'user.created') {
      await this.service.onUserCreated(event.data);
    }

    return { received: true };
  }
}
