import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Owner-role Prisma client — bypasses RLS. Use ONLY for the narrow set of
 * cross-tenant operations that legitimately need it:
 *   - Clerk webhook handlers creating new tenants (no current_company_id yet)
 *   - The TenantContextInterceptor's clerk_user_id → company_id lookup
 *     (chicken-and-egg: we can't read users.company_id under RLS until we
 *      already know which company we are)
 *
 * Every other code path should use PrismaService, which connects as app_user
 * and is subject to RLS.
 */
@Injectable()
export class PrismaAdminService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(
      process.env.DATABASE_URL
        ? { datasources: { db: { url: process.env.DATABASE_URL } } }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
