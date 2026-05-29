import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

export type EmployeePerformanceRange = '7d' | '30d' | '90d';

export type EmployeePerformanceInput = {
  companyId: string;
  range: EmployeePerformanceRange;
  departmentId?: string | null;
};

export type EmployeePerformanceRow = {
  userId: string;
  displayName: string | null;
  email: string;
  assigned: number;
  completed: number;
  // 0–100. Null when there are no completed tasks with a due_date in the
  // range (no denominator → no signal).
  onTimePct: number | null;
  // Mean count of 'task_revision_requested' events across the user's
  // assigned tasks in the range. 0 when assigned=0.
  avgRevisions: number;
};

export type EmployeePerformanceResult = {
  range: EmployeePerformanceRange;
  from: string;
  to: string;
  rows: EmployeePerformanceRow[];
};

// Sprint 18.2 — per-user task performance metrics.
//
// "In-range" means the task was CREATED within the date window. We pick
// created_at as the anchor (not completed_at or anything else) so a row
// in the report corresponds to "work this user picked up in the last N
// days" — the most natural framing for an HR / manager glance.
//
// Assignee set per task = union of:
//   - tasks.assigned_to_user_id (legacy single-assignee column)
//   - task_assignees.user_id    (multi-assignee join, Sprint 8.2+)
// A task with both columns and the join populated counts the same user
// once. UNION dedupes naturally.
//
// On-time: a completed task is "on time" if its task_approved event
// (the only path to status='completed') happened on or before its
// due_date. Tasks without a due_date are excluded from the on-time
// denominator — undefined for those.
//
// Revisions: count of activity_log rows with action_type =
// 'task_revision_requested' targeting the task. Reviewers fire this when
// they bounce a submission back; it's the "redo" signal.
//
// Caching: 5-minute Redis cache keyed by (company, range, deptFilter).

@Injectable()
export class EmployeePerformanceService {
  private static readonly DAYS_PER_RANGE: Record<EmployeePerformanceRange, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  constructor(private readonly cache: RedisCacheService) {}

  async compute(
    db: Prisma.TransactionClient,
    input: EmployeePerformanceInput,
  ): Promise<EmployeePerformanceResult> {
    const days = EmployeePerformanceService.DAYS_PER_RANGE[input.range];
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(today - (days - 1) * 86_400_000);
    const toExclusive = new Date(today + 86_400_000);

    const key = this.cacheKey(input, from, toExclusive);

    return this.cache.getOrSet<EmployeePerformanceResult>(key, 300, async () => {
      const rows = await this.runQuery(db, input, from, toExclusive);
      return {
        range: input.range,
        from: from.toISOString().slice(0, 10),
        to: new Date(today).toISOString().slice(0, 10),
        rows,
      };
    });
  }

  private async runQuery(
    db: Prisma.TransactionClient,
    input: EmployeePerformanceInput,
    from: Date,
    toExclusive: Date,
  ): Promise<EmployeePerformanceRow[]> {
    const deptFilter = input.departmentId
      ? Prisma.sql`AND t.department_id = ${input.departmentId}::uuid`
      : Prisma.sql``;

    // One CTE-based query. The shape:
    //   1. assignment_pairs CTE = (task_id, user_id) UNION over the legacy
    //      single-assignee column + the multi-assignee join, scoped to
    //      tasks created in the range + tenant + optional department.
    //   2. approval_event = the latest task_approved activity_log row per
    //      task, used to compute on-time-ness.
    //   3. revision_counts = per-task count of task_revision_requested
    //      events, scoped to the same created-in-range task set.
    //   4. Aggregate over assignment_pairs joined to all three above.
    //
    // count(*) FILTER (WHERE …) is the cleanest way to do conditional
    // counts inside a single GROUP BY.
    const rows = await db.$queryRaw<
      Array<{
        userId: string;
        displayName: string | null;
        email: string;
        assigned: bigint;
        completed: bigint;
        // numeric/decimal-typed columns can deserialize as string under pg's
        // driver depending on size; we coerce both sides defensively.
        onTimeNumerator: bigint | null;
        onTimeDenominator: bigint | null;
        totalRevisions: bigint;
      }>
    >(Prisma.sql`
      WITH eligible_tasks AS (
        SELECT t.id, t.status, t.due_date, t.assigned_to_user_id
        FROM tasks t
        WHERE t.company_id = ${input.companyId}::uuid
          AND t.deleted_at IS NULL
          AND t.created_at >= ${from}
          AND t.created_at <  ${toExclusive}
          ${deptFilter}
      ),
      assignment_pairs AS (
        -- Multi-assignee join
        SELECT et.id AS task_id, ta.user_id AS user_id
        FROM eligible_tasks et
        JOIN task_assignees ta ON ta.task_id = et.id
        UNION
        -- Legacy single-assignee column (only when set)
        SELECT et.id AS task_id, et.assigned_to_user_id AS user_id
        FROM eligible_tasks et
        WHERE et.assigned_to_user_id IS NOT NULL
      ),
      approval_event AS (
        -- The first task_approved row per task IS the "completed" event
        -- — once a task hits completed it stays terminal. Take MIN(created_at).
        SELECT
          a.target_id AS task_id,
          MIN(a.created_at) AS approved_at
        FROM activity_log a
        WHERE a.company_id = ${input.companyId}::uuid
          AND a.action_type = 'task_approved'
          AND a.target_type = 'task'
          AND a.target_id IN (SELECT id FROM eligible_tasks)
        GROUP BY a.target_id
      ),
      revision_counts AS (
        SELECT
          a.target_id AS task_id,
          COUNT(*) AS revisions
        FROM activity_log a
        WHERE a.company_id = ${input.companyId}::uuid
          AND a.action_type = 'task_revision_requested'
          AND a.target_type = 'task'
          AND a.target_id IN (SELECT id FROM eligible_tasks)
        GROUP BY a.target_id
      )
      SELECT
        u.id                              AS "userId",
        u.display_name                    AS "displayName",
        u.email                           AS "email",
        COUNT(DISTINCT ap.task_id)        AS "assigned",
        COUNT(DISTINCT ap.task_id) FILTER (WHERE ae.approved_at IS NOT NULL) AS "completed",
        COUNT(DISTINCT ap.task_id) FILTER (
          WHERE ae.approved_at IS NOT NULL
            AND et.due_date IS NOT NULL
            AND ae.approved_at::date <= et.due_date
        )                                 AS "onTimeNumerator",
        COUNT(DISTINCT ap.task_id) FILTER (
          WHERE ae.approved_at IS NOT NULL
            AND et.due_date IS NOT NULL
        )                                 AS "onTimeDenominator",
        COALESCE(SUM(rc.revisions), 0)::bigint AS "totalRevisions"
      FROM assignment_pairs ap
      JOIN eligible_tasks et ON et.id = ap.task_id
      JOIN users u ON u.id = ap.user_id
      LEFT JOIN approval_event ae ON ae.task_id = ap.task_id
      LEFT JOIN revision_counts rc ON rc.task_id = ap.task_id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, u.display_name, u.email
      ORDER BY COUNT(DISTINCT ap.task_id) DESC, u.display_name ASC
    `);

    return rows.map((r) => {
      const assigned = Number(r.assigned);
      const completed = Number(r.completed);
      const num = Number(r.onTimeNumerator ?? 0);
      const den = Number(r.onTimeDenominator ?? 0);
      const onTimePct = den === 0 ? null : Math.round((num / den) * 1000) / 10;
      const avgRevisions = assigned === 0 ? 0 : Number(r.totalRevisions) / assigned;
      return {
        userId: r.userId,
        displayName: r.displayName,
        email: r.email,
        assigned,
        completed,
        onTimePct,
        // Round to one decimal place for readability.
        avgRevisions: Math.round(avgRevisions * 10) / 10,
      };
    });
  }

  private cacheKey(input: EmployeePerformanceInput, from: Date, toExclusive: Date): string {
    const payload = JSON.stringify({
      v: 1,
      c: input.companyId,
      r: input.range,
      d: input.departmentId ?? null,
      f: from.toISOString().slice(0, 10),
      t: toExclusive.toISOString().slice(0, 10),
    });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:employee-performance:${hash}`;
  }
}
