import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { DashboardService, type EmployeeDashboardResult } from './dashboard.service';

// GET /dashboard/employee
//   Returns the bundle of widgets for the Employee dashboard. No
//   permission gate — every signed-in user has their OWN dashboard.
//   The five widgets all scope to (companyId, userId) at the SQL layer.

@Controller('dashboard')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('employee')
  async employee(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EmployeeDashboardResult> {
    return this.dashboard.employee(db, tenant.companyId, tenant.userId);
  }
}
