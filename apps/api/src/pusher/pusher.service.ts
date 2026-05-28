import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Pusher from 'pusher';

// Lazy init pattern, same shape as R2Service. The four env vars must all be
// present for trigger()/authorize() to work; missing creds → 503 with a clear
// message so the API still boots cleanly in dev without Pusher.

@Injectable()
export class PusherService {
  private readonly log = new Logger(PusherService.name);
  private client: Pusher | null = null;

  constructor() {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER;

    if (appId && key && secret && cluster) {
      this.client = new Pusher({ appId, key, secret, cluster, useTLS: true });
      this.log.log(`Pusher client initialised (cluster=${cluster})`);
    } else {
      this.log.warn(
        'Pusher env vars missing; real-time push will 503 until ' +
          'PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER are set.',
      );
    }
  }

  // True iff the client was constructed. Callers can branch on this rather
  // than catching the 503 (the notifications writer doesn't want to fail
  // the user's request just because Pusher is unconfigured).
  isConfigured(): boolean {
    return this.client !== null;
  }

  // Fire-and-forget publish. Errors are logged but never rethrown — the
  // notification row already landed in Postgres; the real-time bump is a
  // best-effort UX improvement.
  async safeTrigger(channel: string, event: string, data: unknown): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.trigger(channel, event, data);
    } catch (err) {
      this.log.warn(`Pusher trigger failed (${channel}/${event}): ${(err as Error).message}`);
    }
  }

  // Pusher's auth flow: the JS client posts { socket_id, channel_name } and
  // we sign the response. The controller is responsible for verifying the
  // caller actually owns the requested channel BEFORE calling this.
  authorizeChannel(socketId: string, channel: string): Pusher.AuthResponse {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Real-time notifications are not configured on this server. Set PUSHER_* env vars.',
      );
    }
    return this.client.authorizeChannel(socketId, channel);
  }
}
