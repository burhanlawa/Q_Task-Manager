import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { PaddleWebhookService, type PaddleEvent } from './paddle-webhook.service';

// Sprint 19.6 — Paddle webhook receiver.
//
// Paddle v2 signs every delivery with HMAC-SHA256. The Paddle-Signature
// header is formatted as `ts=<unix-seconds>;h1=<hex-digest>`, and the
// signed payload is `${ts}:${rawBody}`. We verify before touching the
// service so an unsigned (or replayed) event never advances state.
//
// SkipThrottle because Paddle bursts retries on transient failures and
// rate-limiting their delivery would just make us drop events.

// Reject deliveries whose timestamp is more than this many seconds old.
// Tight enough to catch replays, loose enough to survive Paddle's own
// retry cadence (their docs recommend 5 minutes of clock skew tolerance).
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

@Controller('webhooks/paddle')
@SkipThrottle()
export class PaddleWebhookController {
  constructor(private readonly service: PaddleWebhookService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('paddle-signature') signatureHeader: string | undefined,
  ): Promise<{ received: true; processed: boolean }> {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('PADDLE_WEBHOOK_SECRET is required');
    }
    if (!signatureHeader) {
      throw new BadRequestException('Missing paddle-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    if (!verifyPaddleSignature(signatureHeader, req.rawBody, secret)) {
      throw new UnauthorizedException('Invalid paddle signature');
    }

    let event: PaddleEvent;
    try {
      event = JSON.parse(req.rawBody.toString('utf8')) as PaddleEvent;
    } catch {
      throw new BadRequestException('Body is not valid JSON');
    }
    if (typeof event.event_id !== 'string' || typeof event.event_type !== 'string') {
      throw new BadRequestException('Body missing event_id or event_type');
    }

    const result = await this.service.handle(event);
    return { received: true, processed: result.processed };
  }
}

// Exported so unit tests can exercise the parser without going through
// the controller (NestJS controllers are awkward to instantiate inline).
export function verifyPaddleSignature(header: string, rawBody: Buffer, secret: string): boolean {
  const parts = parseSignatureHeader(header);
  if (!parts) return false;
  const { ts, h1 } = parts;

  // Replay window. ts is unix-seconds.
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSeconds > SIGNATURE_MAX_AGE_SECONDS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${ts}:${rawBody.toString('utf8')}`)
    .digest('hex');

  // Constant-time compare to avoid timing oracles.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(h1, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseSignatureHeader(header: string): { ts: string; h1: string } | null {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, v] = part.split('=', 2);
    if (k && v) out[k.trim()] = v.trim();
  }
  if (!out.ts || !out.h1) return null;
  return { ts: out.ts, h1: out.h1 };
}
