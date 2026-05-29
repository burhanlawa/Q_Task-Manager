import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

export type WorkloadDistributionInput = {
  companyId: string;
  departmentId?: string | null;
};

export type WorkloadRow = {
  userId: string;
  displayName: string | null;
  email: string;
  // Total open tasks assigned to this user.
  openCount: number;
  // Same set, broken down by priority for context.
  byPriority: {
    low: number;
    medium: number;
    high: number;
    urgent: number;
  };
  // Sum of per-task weights. weights: low=1, medium=2, high=3, urgent=4.
  weightedLoad: number;
};

export type WorkloadDistributionResult = {
  rows: WorkloadRow[];
};

// Sprint 18.3 — current workload by assignee.
//
// "Open" = task status is one of {draft, assigned, in_progress, submitted,
// reassignment_requested}. Terminal states (approved/completed/cancelled/rejected)
// are NOT open. Soft-deleted tasks are skipped.
//
// Assignee set = UNION of multi-assignee join + legacy single-assignee
// column (same shape as 18.2). UNION dedupes when both reference the
// same user.
//
// Priority weights chosen to give urgent ~4× the pull of low — picks up
// "one urgent" beating "two mediums" without making everything noise.
// Cheap to tune: change the CASE expression and bump the cache key version.
//
// Cache: 5 minutes per (company, dept) tuple. Same shape as 18.1/18.2.

@Injectable()
export class WorkloadDistributionService {
  // Priority weights live in code (not the DB) so they can be tuned
  // without a migration. If a tenant ever wants per-tenant weights,
  // promote to a company_settings column.
  private static readonly WEIGHTS = { low: 1, medium: 2, high: 3, urgent: 4 } as const;

  constructor(private readonly cache: RedisCacheService) {}

  async compute(
    db: Prisma.TransactionClient,
    input: WorkloadDistributionInput,
  ): Promise<WorkloadDistributionResult> {
    const key = this.cacheKey(input);

    return this.cache.getOrSet<WorkloadDistributionResult>(key, 300, async () => {
      const rows = await this.runQuery(db, input);
      return { rows };
    });
  }

  private async runQuery(
    db: Prisma.TransactionClient,
    input: WorkloadDistributionInput,
  ): Promise<WorkloadRow[]> {
    const deptFilter = input.departmentId
      ? Prisma.sql`AND t.department_id = ${input.departmentId}::uuid`
      : Prisma.sql``;

    const W = WorkloadDistributionService.WEIGHTS;

    // CTE pattern: open_tasks → assignment_pairs (UNION) → GROUP BY user.
    // count(*) FILTER (WHERE priority=...) gives us the per-priority
    // breakdown in the same scan.
    const rows = await db.$queryRaw<
      Array<{
        userId: string;
        displayName: string | null;
        email: string;
        openCount: bigint;
        low: bigint;
        medium: bigint;
        high: bigint;
        urgent: bigint;
        weightedLoad: bigint;
      }>
    >(Prisma.sql`
      WITH open_tasks AS (
        SELECT t.id, t.priority, t.assigned_to_user_id
        FROM tasks t
        WHERE t.company_id = ${input.companyId}::uuid
          AND t.deleted_at IS NULL
          AND t.status IN ('draft', 'assigned', 'in_progress', 'submitted', 'reassignment_requested')
          ${deptFilter}
      ),
      assignment_pairs AS (
        SELECT ot.id AS task_id, ot.priority, ta.user_id
        FROM open_tasks ot
        JOIN task_assignees ta ON ta.task_id = ot.id
        UNION
        SELECT ot.id AS task_id, ot.priority, ot.assigned_to_user_id AS user_id
        FROM open_tasks ot
        WHERE ot.assigned_to_user_id IS NOT NULL
      )
      SELECT
        u.id                                                                   AS "userId",
        u.display_name                                                         AS "displayName",
        u.email                                                                AS "email",
        COUNT(DISTINCT ap.task_id)                                             AS "openCount",
        COUNT(DISTINCT ap.task_id) FILTER (WHERE ap.priority = 'low')          AS "low",
        COUNT(DISTINCT ap.task_id) FILTER (WHERE ap.priority = 'medium')       AS "medium",
        COUNT(DISTINCT ap.task_id) FILTER (WHERE ap.priority = 'high')         AS "high",
        COUNT(DISTINCT ap.task_id) FILTER (WHERE ap.priority = 'urgent')       AS "urgent",
        SUM(
          CASE ap.priority
            WHEN 'low'    THEN ${W.low}
            WHEN 'medium' THEN ${W.medium}
            WHEN 'high'   THEN ${W.high}
            WHEN 'urgent' THEN ${W.urgent}
            ELSE 0
          END
        )::bigint                                                              AS "weightedLoad"
      FROM assignment_pairs ap
      JOIN users u ON u.id = ap.user_id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, u.display_name, u.email
      ORDER BY "weightedLoad" DESC, "openCount" DESC, u.display_name ASC
    `);

    return rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      email: r.email,
      openCount: Number(r.openCount),
      byPriority: {
        low: Number(r.low),
        medium: Number(r.medium),
        high: Number(r.high),
        urgent: Number(r.urgent),
      },
      weightedLoad: Number(r.weightedLoad),
    }));
  }

  private cacheKey(input: WorkloadDistributionInput): string {
    const payload = JSON.stringify({
      v: 1,
      c: input.companyId,
      d: input.departmentId ?? null,
    });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:workload-distribution:${hash}`;
  }
}
