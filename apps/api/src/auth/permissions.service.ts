import { Injectable, Logger } from '@nestjs/common';
import { PrismaAdminService } from '../prisma/prisma-admin.service';

/**
 * Single source of truth for "what permissions does this user effectively have?"
 *
 * Unions:
 *   - user_roles → roles.permissions (direct grants)
 *   - user_system_roles → roles by name → roles.permissions
 *
 * Wildcard '*' is preserved in the resulting set (callers short-circuit on it).
 *
 * Cached in process with a 5-minute TTL keyed by user_id. The hot path
 * (PermissionsGuard on every authed request) hits Postgres at most once per
 * user per 5 minutes (Sprint 6 task 6.7).
 *
 * TODO(Sprint 14-ish): swap the in-memory map for a Redis-backed store
 * (ioredis + ThrottlerStorageRedisService pattern). The interface is already
 * permission-set-shaped so the swap is local. Logged in
 * project_followups.md > "Redis-backed throttler" → extend to this service.
 */
@Injectable()
export class PermissionsService {
  private readonly log = new Logger(PermissionsService.name);
  private readonly cache = new Map<string, { perms: Set<string>; expiresAt: number }>();
  private readonly ttlMs = 5 * 60 * 1000;

  constructor(private readonly admin: PrismaAdminService) {}

  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.perms;

    const u = await this.admin.user.findUnique({
      where: { id: userId },
      select: {
        companyId: true,
        roles: {
          where: { role: { deletedAt: null } },
          select: { role: { select: { permissions: true } } },
        },
        systemRoles: { select: { systemRole: true } },
      },
    });
    const granted = new Set<string>();
    if (!u) {
      this.cache.set(userId, { perms: granted, expiresAt: Date.now() + this.ttlMs });
      return granted;
    }
    for (const ur of u.roles) {
      const perms = ur.role.permissions;
      if (Array.isArray(perms)) for (const p of perms) if (typeof p === 'string') granted.add(p);
    }
    if (u.systemRoles.length > 0) {
      const names = u.systemRoles.map((s) => s.systemRole);
      const sysRoles = await this.admin.role.findMany({
        where: { companyId: u.companyId, name: { in: names }, deletedAt: null },
        select: { permissions: true },
      });
      for (const r of sysRoles) {
        const perms = r.permissions;
        if (Array.isArray(perms)) for (const p of perms) if (typeof p === 'string') granted.add(p);
      }
    }
    this.cache.set(userId, { perms: granted, expiresAt: Date.now() + this.ttlMs });
    return granted;
  }

  /** True if the user has '*' or the specific key. */
  has(granted: Set<string>, key: string): boolean {
    return granted.has('*') || granted.has(key);
  }

  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Invalidate the cache for every user holding the given role. Used when a
   * role's permissions list changes (RolesController.update).
   */
  async invalidateUsersWithRole(roleId: string): Promise<void> {
    const rows = await this.admin.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    for (const r of rows) this.cache.delete(r.userId);
    if (rows.length > 0)
      this.log.log(
        `Invalidated permissions cache for ${rows.length} user(s) after role ${roleId} change`,
      );
  }

  /**
   * Invalidate every user holding the system role *name* (i.e. anyone whose
   * user_system_roles row points to a role with this name). Used when a role
   * is renamed or its permissions change, since user_system_roles joins by
   * string name rather than id.
   */
  async invalidateUsersWithSystemRoleName(roleName: string): Promise<void> {
    const rows = await this.admin.userSystemRole.findMany({
      where: { systemRole: roleName },
      select: { userId: true },
    });
    for (const r of rows) this.cache.delete(r.userId);
    if (rows.length > 0)
      this.log.log(
        `Invalidated permissions cache for ${rows.length} user(s) holding system role '${roleName}'`,
      );
  }

  /** Diagnostic helpers — used by tests/internal probes only. */
  cacheSize(): number {
    return this.cache.size;
  }
  isCached(userId: string): boolean {
    const hit = this.cache.get(userId);
    return !!hit && hit.expiresAt > Date.now();
  }
}
