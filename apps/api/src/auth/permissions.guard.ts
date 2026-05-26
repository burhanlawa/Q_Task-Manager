import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import type { RequestAuth } from './clerk-auth.guard';
import { PermissionsService } from './permissions.service';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

type AuthedRequest = { auth?: RequestAuth };

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: PrismaAdminService,
    private readonly permissions: PermissionsService,
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
      throw new ForbiddenException('Permission check requires authentication');
    }

    // Resolve clerk_user_id → user_id once (cheap, single column lookup).
    // The expensive permission union is then cached inside PermissionsService
    // by user_id for 5 minutes — so the hot path stays one fast lookup.
    const u = await this.admin.user.findUnique({
      where: { clerkUserId: req.auth.userId },
      select: { id: true },
    });
    if (!u) throw new ForbiddenException('No tenant for this user');

    const granted = await this.permissions.getEffectivePermissions(u.id);
    if (granted.has('*')) return true;
    for (const key of required) {
      if (!granted.has(key)) {
        throw new ForbiddenException(`Missing permission: ${key}`);
      }
    }
    return true;
  }
}
