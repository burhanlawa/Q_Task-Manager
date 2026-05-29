import { Controller, ForbiddenException, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { DashboardService, type EmployeeDashboardResult } from './dashboard.service';
import { ManagerDashboardService, type ManagerDashboardResult } from './manager-dashboard.service';

// Roles that can see the Manager-tier dashboard (Sprint 18.6 scope per
// blueprint — until Phase 1.5 splits this into separate Supervisor/HR/CEO
// pages). Employees are blocked; the role gate is here in the controller
// rather than via a permission key so we can keep the same endpoint for
// all four allowed roles with different scope resolution downstream.
const MANAGER_TIER_ROLES = new Set(['ceo', 'admin', 'hr', 'manager', 'supervisor']);

@Controller('dashboard')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly managerDashboard: ManagerDashboardService,
  ) {}

  // GET /dashboard/employee
  //   No permission gate — every signed-in user has their OWN dashboard.
  //   The five widgets all scope to (companyId, userId) at the SQL layer.
  @Get('employee')
  async employee(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EmployeeDashboardResult> {
    return this.dashboard.employee(db, tenant.companyId, tenant.userId);
  }

  // GET /dashboard/manager
  //   Same endpoint for CEO/Admin/HR/Manager/Supervisor; scope resolution
  //   happens in the service so the visibility rules can't drift between
  //   role check and SQL filter. Employee → 403.
  @Get('manager')
  async manager(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ManagerDashboardResult> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, departmentId: true },
    });
    if (!me) throw new ForbiddenException('User not found');
    if (!MANAGER_TIER_ROLES.has(me.orgRole)) {
      throw new ForbiddenException('Your role does not have access to the manager dashboard');
    }
    return this.managerDashboard.run(db, {
      companyId: tenant.companyId,
      callerUserId: tenant.userId,
      callerOrgRole: me.orgRole,
      callerDepartmentId: me.departmentId,
    });
  }
}
