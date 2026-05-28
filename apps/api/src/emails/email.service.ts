import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /// Idempotency key — pass `notification.id` so a BullMQ retry doesn't
  /// cause Resend to send the same email twice. Resend dedupes by this for
  /// 24 hours.
  idempotencyKey?: string;
  /// Optional tags (Resend metadata). Useful for filtering in the dashboard.
  tags?: Record<string, string>;
};

// Thin wrapper over the Resend SDK. Lazy init: the API boots without
// RESEND_API_KEY (calls 503 in that case). Same pattern as R2 + Pusher so
// dev workflows that don't exercise email keep working.
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private client: Resend | null = null;
  private readonly fromAddress: string | undefined;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromAddress = process.env.RESEND_FROM_ADDRESS;

    if (apiKey && this.fromAddress) {
      this.client = new Resend(apiKey);
      this.log.log(`Resend client initialised (from=${this.fromAddress})`);
    } else {
      this.log.warn(
        'Resend env vars missing; email sending will 503 until ' +
          'RESEND_API_KEY and RESEND_FROM_ADDRESS are set.',
      );
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  // Sends one email. Throws on failure so the BullMQ worker can decide
  // whether to retry (5xx = retry, 4xx = giving up). Returns Resend's
  // message id on success — useful for support questions.
  async send(input: EmailSendInput): Promise<{ id: string }> {
    if (!this.client || !this.fromAddress) {
      throw new ServiceUnavailableException(
        'Email is not configured on this server. Set RESEND_API_KEY + RESEND_FROM_ADDRESS.',
      );
    }
    const { data, error } = await this.client.emails.send(
      {
        from: this.fromAddress,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        tags: input.tags
          ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
          : undefined,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (error) {
      // Resend SDK puts the HTTP status on the error so BullMQ's retry
      // policy (only retry on 5xx) can branch on it.
      const err = new Error(error.message) as Error & { statusCode?: number };
      // Resend uses the `name` field for the error type (e.g. 'validation_error').
      // The HTTP status isn't exposed directly; we infer it from common names.
      err.statusCode = transientErrorName(error.name) ? 503 : 400;
      throw err;
    }
    return { id: data!.id };
  }
}

// Resend's `name` field is a string like 'rate_limit_exceeded',
// 'application_error', 'internal_server_error'. We treat anything that
// looks like a server-side or network issue as retriable.
function transientErrorName(name: string): boolean {
  return (
    name === 'rate_limit_exceeded' ||
    name === 'internal_server_error' ||
    name === 'application_error' ||
    name === 'request_timeout'
  );
}
