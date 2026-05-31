import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// Sprint 21.5 — slow-query threshold. Queries that take longer than
// this get logged at warn level with their full SQL + params. Tuned
// from blueprint goal "queries > 200ms identified". Override via
// env so an operator can tighten/loosen without a deploy.
const SLOW_QUERY_MS = Number.parseInt(process.env.SLOW_QUERY_MS ?? '200', 10);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);

  constructor() {
    // Connect as the unprivileged app_user so RLS policies enforce tenant
    // isolation. DATABASE_URL points at the owner role (used for migrations);
    // APP_DATABASE_URL is the RLS-subject role. Fall back to DATABASE_URL only
    // if APP_DATABASE_URL is not set, to keep dev/CI working when only the
    // owner URL is configured — but emit a loud warning so we notice.
    const appUrl = process.env.APP_DATABASE_URL;
    if (!appUrl && process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaService] APP_DATABASE_URL not set — falling back to DATABASE_URL ' +
          '(owner role bypasses RLS). Set APP_DATABASE_URL for tenant isolation to work.',
      );
    }
    super({
      ...(appUrl ? { datasources: { db: { url: appUrl } } } : {}),
      // Emit query events so we can tap them and surface slow ones.
      // Other levels stay on stdout — this is just an additional event
      // subscription, not a replacement.
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  async onModuleInit(): Promise<void> {
    // Slow-query tap (Sprint 21.5). Prisma's query event carries the
    // SQL text, params, and elapsed ms. Anything past SLOW_QUERY_MS
    // logs at warn level so it shows up alongside other warnings; a
    // Sentry/PostHog wiring later can ingest from the same hook.
    (this as unknown as { $on: (e: 'query', cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
      'query',
      (e: Prisma.QueryEvent) => {
        if (e.duration >= SLOW_QUERY_MS) {
          this.log.warn(`slow query ${e.duration}ms: ${e.query} params=${e.params}`);
        }
      },
    );
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
