import { Body, Controller, Get, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

class UpdateCompanySettingsDto {
  @IsOptional()
  @IsBoolean()
  allow_image_attachments?: boolean;
}

@Controller('company-settings')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class CompanySettingsController {
  // Read the tenant's settings. Anyone who can use the app can read (so the
  // upload widget knows whether to even offer JPG/PNG); writing is gated.
  @Get()
  async get(@TenantDb() db: Prisma.TransactionClient, @CurrentTenant() tenant: TenantContext) {
    // upsert-on-read so tenants that pre-date company_settings get a row.
    return db.companySetting.upsert({
      where: { companyId: tenant.companyId },
      update: {},
      create: { companyId: tenant.companyId },
      select: {
        allowImageAttachments: true,
        onboardingApprovalChain: true,
      },
    });
  }

  // Patch a subset of settings. Gated by company.manage so only admins flip.
  @Patch()
  @RequirePermissions('company.manage')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateCompanySettingsDto,
  ) {
    return db.companySetting.upsert({
      where: { companyId: tenant.companyId },
      update: {
        ...(dto.allow_image_attachments !== undefined
          ? { allowImageAttachments: dto.allow_image_attachments }
          : {}),
      },
      create: {
        companyId: tenant.companyId,
        ...(dto.allow_image_attachments !== undefined
          ? { allowImageAttachments: dto.allow_image_attachments }
          : {}),
      },
      select: {
        allowImageAttachments: true,
        onboardingApprovalChain: true,
      },
    });
  }
}
