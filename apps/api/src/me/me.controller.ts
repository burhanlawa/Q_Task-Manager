import { Controller, Get, NotFoundException, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';

@Controller('me')
@UseGuards(ClerkAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeController {
  @Get()
  async profile(@CurrentTenant() tenant: TenantContext, @TenantDb() db: Prisma.TransactionClient) {
    const user = await db.user.findUnique({
      where: { id: tenant.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        phone: true,
        avatarFileId: true,
        locale: true,
        timezone: true,
        orgRole: true,
        status: true,
        employmentStatus: true,
        companyId: true,
        branchId: true,
        departmentId: true,
        lastLoginAt: true,
        company: { select: { id: true, name: true, slug: true, status: true, country: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Get('tenant')
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
