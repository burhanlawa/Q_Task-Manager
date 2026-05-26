import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { UpdateMeDto } from './dto/update-me.dto';

const ME_SELECT = {
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
  dateOfBirth: true, // sensitive in general, but reading your own DOB is fine + not audited
  lastLoginAt: true,
  company: { select: { id: true, name: true, slug: true, status: true, country: true } },
} satisfies Prisma.UserSelect;

@Controller('me')
@UseGuards(ClerkAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeController {
  @Get()
  async profile(@CurrentTenant() tenant: TenantContext, @TenantDb() db: Prisma.TransactionClient) {
    const user = await db.user.findUnique({
      where: { id: tenant.userId },
      select: ME_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Patch()
  async update(
    @CurrentTenant() tenant: TenantContext,
    @TenantDb() db: Prisma.TransactionClient,
    @Body() dto: UpdateMeDto,
  ) {
    // Self-edit endpoint: every authenticated user can call this. The DTO's
    // class-validator whitelist (and main.ts's forbidNonWhitelisted) means
    // unknown fields like `orgRole` are rejected with 400 — the user can't
    // sneak organizational fields into the request.
    const data: Prisma.UserUncheckedUpdateManyInput = {};
    for (const k of ['firstName', 'lastName', 'displayName', 'phone', 'timezone'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth === null ? null : new Date(dto.dateOfBirth);
    }

    const result = await db.user.updateMany({
      where: { id: tenant.userId, deletedAt: null },
      data,
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    return db.user.findUnique({ where: { id: tenant.userId }, select: ME_SELECT });
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
