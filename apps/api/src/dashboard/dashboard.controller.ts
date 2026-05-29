import { Controller, ForbiddenException, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { AdminDashboardService, type AdminDashboardResult } from './admin-dashboard.service';
import { DashboardService, type EmployeeDashboardResult } from './dashboard.service';
import { ManagerDashboardService, type ManagerDashboardResult } from './manager-dashboard.service';

// Roles that can see the Manager-tier dashboard (Sprint 18.6 scope per
// blueprint — until Phase 1.5 splits this into separate Supervisor/HR/CEO
// pages). Employees are blocked; the role gate is here in the controller
// rather than via a permission key so we can keep the same endpoint for
// all four allowed roles with different scope resolution downstream.
const MANAGER_TIER_ROLES = new Set(['ceo', 'admin', 'hr', 'manager', 'supervisor']);

// Admin dashboard is strictly CEO/Admin per spec — the system-health and
// security-alert cards are tenant-wide and don't have a sensible Manager
// or HR view (those will likely get tailored dashboards in Phase 1.5).
const ADMIN_TIER_ROLES = new Set(['ceo', 'admin']);

// Sprint 18.8 — system role NAMES that grant admin or manager-tier
// access on top of whatever the user's org_role grants. Both signals
// union when computing /dashboard/available so a Manager-by-org-role
// who's been granted the 'Admin' system role unlocks the admin
// dashboard variant too. Names come from the Sprint 4.5 built-in role
// seed; the role table is the source of truth, but for routing we just
// match by display name.
const ADMIN_SYSTEM_ROLE_NAMES = new Set(['CEO', 'Admin']);
const MANAGER_SYSTEM_ROLE_NAMES = new Set(['CEO', 'Admin', 'Manager', 'HR', 'Supervisor']);

type DashboardVariant = 'employee' | 'manager' | 'admin';

@Controller('dashboard')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly managerDashboard: ManagerDashboardService,
    private readonly adminDashboard: AdminDashboardService,
  ) {}

  // GET /dashboard/available
  //   Returns the list of dashboard variants this user can access plus a
  //   primary recommendation. Used by the web's /dashboard redirect logic
  //   and by the header switcher when the list has more than one entry.
  //   Both org_role AND any granted system roles count — a Manager who's
  //   been given the Admin system role unlocks the admin variant.
  @Get('available')
  async available(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{ available: DashboardVariant[]; primary: DashboardVariant }> {
    const [me, systemRoles] = await Promise.all([
      db.user.findUnique({ where: { id: tenant.userId }, select: { orgRole: true } }),
      db.userSystemRole.findMany({
        where: { userId: tenant.userId },
        select: { systemRole: true },
      }),
    ]);
    if (!me) throw new ForbiddenException('User not found');

    const sysNames = new Set(systemRoles.map((r) => r.systemRole));
    const canSeeAdmin =
      ADMIN_TIER_ROLES.has(me.orgRole) || [...sysNames].some((n) => ADMIN_SYSTEM_ROLE_NAMES.has(n));
    const canSeeManager =
      MANAGER_TIER_ROLES.has(me.orgRole) ||
      [...sysNames].some((n) => MANAGER_SYSTEM_ROLE_NAMES.has(n));

    // Employee variant is always available — every signed-in user has
    // their own "my tasks" view.
    const available: DashboardVariant[] = ['employee'];
    if (canSeeManager) available.push('manager');
    if (canSeeAdmin) available.push('admin');

    // Primary recommendation = highest-privilege variant. Admins land
    // on the admin view, managers on the manager view, everyone else
    // on employee. The user can switch via the header dropdown.
    const primary: DashboardVariant = canSeeAdmin
      ? 'admin'
      : canSeeManager
        ? 'manager'
        : 'employee';

    return { available, primary };
  }

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
    const [me, systemRoles] = await Promise.all([
      db.user.findUnique({
        where: { id: tenant.userId },
        select: { orgRole: true, departmentId: true },
      }),
      db.userSystemRole.findMany({
        where: { userId: tenant.userId },
        select: { systemRole: true },
      }),
    ]);
    if (!me) throw new ForbiddenException('User not found');
    const sysNames = new Set(systemRoles.map((r) => r.systemRole));
    const allowed =
      MANAGER_TIER_ROLES.has(me.orgRole) ||
      [...sysNames].some((n) => MANAGER_SYSTEM_ROLE_NAMES.has(n));
    if (!allowed) {
      throw new ForbiddenException('Your role does not have access to the manager dashboard');
    }
    return this.managerDashboard.run(db, {
      companyId: tenant.companyId,
      callerUserId: tenant.userId,
      callerOrgRole: me.orgRole,
      callerDepartmentId: me.departmentId,
    });
  }

  // GET /dashboard/admin
  //   Strictly CEO/Admin. Returns system health, subscription status,
  //   recent security-relevant audit events, and a focused permission-
  //   changes feed. Cached per company for 60 seconds.
  @Get('admin')
  async admin(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdminDashboardResult> {
    const [me, systemRoles] = await Promise.all([
      db.user.findUnique({
        where: { id: tenant.userId },
        select: { orgRole: true },
      }),
      db.userSystemRole.findMany({
        where: { userId: tenant.userId },
        select: { systemRole: true },
      }),
    ]);
    if (!me) throw new ForbiddenException('User not found');
    const sysNames = new Set(systemRoles.map((r) => r.systemRole));
    const allowed =
      ADMIN_TIER_ROLES.has(me.orgRole) || [...sysNames].some((n) => ADMIN_SYSTEM_ROLE_NAMES.has(n));
    if (!allowed) {
      throw new ForbiddenException('Your role does not have access to the admin dashboard');
    }
    return this.adminDashboard.run(db, tenant.companyId);
  }
}
