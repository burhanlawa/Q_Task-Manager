import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import type { RequestAuth } from './clerk-auth.guard';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

type AuthedRequest = { auth?: RequestAuth };

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: PrismaAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) {
      // ClerkAuthGuard must run before us. If req.auth is missing, wiring is wrong.
      throw new ForbiddenException('Permission check requires authentication');
    }

    // Guards run before interceptors, so TenantContextInterceptor hasn't run yet
    // — we resolve our own user via the admin client (same pattern the
    // interceptor uses for the clerk-id → user-id lookup).
    const user = await this.admin.user.findUnique({
      where: { clerkUserId: req.auth.userId },
      select: {
        id: true,
        companyId: true,
        roles: {
          where: { role: { deletedAt: null } },
          select: { role: { select: { permissions: true } } },
        },
        systemRoles: { select: { systemRole: true } },
      },
    });

    if (!user) throw new ForbiddenException('No tenant for this user');

    const granted = new Set<string>();

    // 1. Direct role grants via user_roles.
    for (const ur of user.roles) {
      const perms = ur.role.permissions;
      if (Array.isArray(perms)) {
        for (const p of perms) if (typeof p === 'string') granted.add(p);
      }
    }

    // 2. System-role grants via user_system_roles. The `systemRole` string is
    // a free-form pointer; we resolve it to a role by name within the tenant
    // and union its permissions. This lets an admin grant "HR" power to an
    // Employee-by-position without touching the user_roles table directly.
    if (user.systemRoles.length > 0) {
      const names = user.systemRoles.map((s) => s.systemRole);
      const systemRoles = await this.admin.role.findMany({
        where: { companyId: user.companyId, name: { in: names }, deletedAt: null },
        select: { permissions: true },
      });
      for (const r of systemRoles) {
        const perms = r.permissions;
        if (Array.isArray(perms)) {
          for (const p of perms) if (typeof p === 'string') granted.add(p);
        }
      }
    }
    if (granted.has('*')) return true;
    for (const key of required) {
      if (!granted.has(key)) {
        throw new ForbiddenException(`Missing permission: ${key}`);
      }
    }
    return true;
  }
}
