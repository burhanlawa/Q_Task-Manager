import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

// Action types we treat as "security-relevant" for the alerts feed.
// All come from existing audit log writers (Sprint 5, 6, 7, 16). The
// list is a constant on purpose — extending it should be a deliberate
// commit, not a config change.
const SECURITY_ACTION_TYPES = [
  'read_sensitive_field', // Sprint 5 — audit PII reads
  'role_permissions_changed', // Sprint 6 — role definition mutated
  'role_granted', // Sprint 6 follow-up — direct role grant
  'role_revoked', // Sprint 6 follow-up — direct role revoke
  'invited', // Sprint 7 — new tenant member invited
  'approval_advanced', // Sprint 7 — invitation approval moved forward
  'activated', // Sprint 7 — invited user activated their account
] as const;

export type AdminDashboardResult = {
  systemHealth: {
    activeUsers: number; // org_role != employee + status = active
    totalUsers: number; // all non-deleted users
    invitedUsers: number; // users in 'invited' status (pending activation)
    suspendedUsers: number; // users in 'suspended' or 'deactivated' status
    storageUsedBytes: string; // bigint serialized as string
    tasksOpen: number;
    tasksCompletedLast30: number;
  };
  subscription: {
    plan: string;
    status: string;
    daysSinceJoined: number;
    storageUsedBytes: string;
  };
  securityAlerts: Array<{
    id: string;
    createdAt: string;
    actionType: string;
    actorUserId: string | null;
    actorName: string | null;
    targetType: string | null;
    targetId: string | null;
    fieldChanged: string | null;
  }>;
  recentPermissionChanges: Array<{
    id: string;
    createdAt: string;
    actorUserId: string | null;
    actorName: string | null;
    actionType: string; // role_permissions_changed | role_granted | role_revoked
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
  }>;
};

// Sprint 18.7 — Admin dashboard.
//
// All four widgets pull from data we already have: users + companies +
// tasks + activity_log. Caches per company for 60s (admin reloads on
// focus, and 60s smooths over the common "open the page, glance, leave"
// usage).
//
// Permission gate happens in the controller (org_role in [ceo, admin]);
// nothing in the service is per-user, so the cache key is just companyId.

@Injectable()
export class AdminDashboardService {
  constructor(private readonly cache: RedisCacheService) {}

  async run(db: Prisma.TransactionClient, companyId: string): Promise<AdminDashboardResult> {
    const key = this.cacheKey(companyId);
    return this.cache.getOrSet<AdminDashboardResult>(key, 60, async () => {
      const [systemHealth, subscription, securityAlerts, recentPermissionChanges] =
        await Promise.all([
          this.getSystemHealth(db, companyId),
          this.getSubscription(db, companyId),
          this.getSecurityAlerts(db, companyId),
          this.getRecentPermissionChanges(db, companyId),
        ]);
      return { systemHealth, subscription, securityAlerts, recentPermissionChanges };
    });
  }

  private async getSystemHealth(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<AdminDashboardResult['systemHealth']> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [userCounts, company, tasksOpen, tasksCompletedLast30] = await Promise.all([
      db.user.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: true,
      }),
      db.company.findUnique({
        where: { id: companyId },
        select: { storageUsedBytes: true },
      }),
      db.task.count({
        where: {
          companyId,
          deletedAt: null,
          status: {
            in: ['draft', 'assigned', 'in_progress', 'submitted', 'reassignment_requested'],
          },
        },
      }),
      db.task.count({
        where: {
          companyId,
          deletedAt: null,
          status: 'completed',
          updatedAt: { gte: since },
        },
      }),
    ]);

    const byStatus = Object.fromEntries(userCounts.map((g) => [g.status, g._count]));
    const totalUsers = Object.values(byStatus).reduce((a, b) => a + (b as number), 0);
    return {
      activeUsers: byStatus.active ?? 0,
      totalUsers,
      invitedUsers: byStatus.invited ?? 0,
      suspendedUsers: (byStatus.suspended ?? 0) + (byStatus.deactivated ?? 0),
      storageUsedBytes: (company?.storageUsedBytes ?? BigInt(0)).toString(),
      tasksOpen,
      tasksCompletedLast30,
    };
  }

  private async getSubscription(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<AdminDashboardResult['subscription']> {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: {
        plan: true,
        status: true,
        storageUsedBytes: true,
        createdAt: true,
      },
    });
    if (!company) {
      // RLS will normally prevent this branch, but typescript wants it.
      return {
        plan: 'unknown',
        status: 'unknown',
        daysSinceJoined: 0,
        storageUsedBytes: '0',
      };
    }
    const daysSinceJoined = Math.floor((Date.now() - company.createdAt.getTime()) / 86_400_000);
    return {
      plan: company.plan,
      status: company.status,
      daysSinceJoined,
      storageUsedBytes: company.storageUsedBytes.toString(),
    };
  }

  private async getSecurityAlerts(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<AdminDashboardResult['securityAlerts']> {
    // Most recent 10 audit entries from the security-relevant action set.
    // Joins to users for the actor's display name so the card renders
    // without a follow-up call.
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        actionType: string;
        actorUserId: string | null;
        actorName: string | null;
        targetType: string | null;
        targetId: string | null;
        fieldChanged: string | null;
      }>
    >(Prisma.sql`
      SELECT
        a.id,
        a.created_at      AS "createdAt",
        a.action_type     AS "actionType",
        a.actor_user_id   AS "actorUserId",
        u.display_name    AS "actorName",
        a.target_type     AS "targetType",
        a.target_id       AS "targetId",
        a.field_changed   AS "fieldChanged"
      FROM activity_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.action_type IN (${Prisma.join(SECURITY_ACTION_TYPES.map((t) => Prisma.sql`${t}`))})
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 10
    `);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actionType: r.actionType,
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      targetType: r.targetType,
      targetId: r.targetId,
      fieldChanged: r.fieldChanged,
    }));
  }

  private async getRecentPermissionChanges(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<AdminDashboardResult['recentPermissionChanges']> {
    // The narrower "role/permission" subset of the security feed. Splits
    // visually as its own card since these answer "who changed access?"
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        actionType: string;
        actorUserId: string | null;
        actorName: string | null;
        targetType: string | null;
        targetId: string | null;
        metadata: unknown;
      }>
    >(Prisma.sql`
      SELECT
        a.id,
        a.created_at      AS "createdAt",
        a.action_type     AS "actionType",
        a.actor_user_id   AS "actorUserId",
        u.display_name    AS "actorName",
        a.target_type     AS "targetType",
        a.target_id       AS "targetId",
        a.metadata        AS "metadata"
      FROM activity_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.action_type IN ('role_permissions_changed', 'role_granted', 'role_revoked')
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 10
    `);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
    }));
  }

  private cacheKey(companyId: string): string {
    const payload = JSON.stringify({ v: 1, c: companyId });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:dashboard:admin:${hash}`;
  }
}
