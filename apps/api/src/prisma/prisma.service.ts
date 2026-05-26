import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
    super(appUrl ? { datasources: { db: { url: appUrl } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
