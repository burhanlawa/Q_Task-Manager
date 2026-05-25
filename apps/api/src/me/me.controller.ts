import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { ClerkAuthGuard, type RequestAuth } from '../auth/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import type { Prisma } from '@prisma/client';

@Controller('me')
@UseGuards(ClerkAuthGuard)
export class MeController {
  @Get()
  whoami(@CurrentAuth() auth: RequestAuth): { clerkUserId: string; sessionId: string | null } {
    return { clerkUserId: auth.userId, sessionId: auth.sessionId };
  }

  @Get('tenant')
  @UseInterceptors(TenantContextInterceptor)
  async tenant(
    @CurrentTenant() tenant: TenantContext,
    @TenantDb() db: Prisma.TransactionClient,
  ): Promise<{ companyId: string; rlsCompanyId: string | null }> {
    const rows = await db.$queryRaw<Array<{ v: string | null }>>`
      SELECT current_setting('app.current_company_id', true) AS v
    `;
    return { companyId: tenant.companyId, rlsCompanyId: rows[0]?.v ?? null };
  }
}
