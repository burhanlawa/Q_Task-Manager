import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

export type RangePreset = '7d' | '30d' | '90d';

export type TasksCompletionInput = {
  companyId: string;
  range: RangePreset;
  // Optional filters; both nullable so the controller can pass `undefined`
  // for "no filter" without conditional spread at the call site.
  departmentId?: string | null;
  assigneeUserId?: string | null;
};

export type DayBucket = {
  /// 'YYYY-MM-DD' in UTC. The aggregation groups by date_trunc('day',
  /// created_at) which lives in Postgres time; we serialize ISO date.
  date: string;
  completed: number;
  total: number;
};

export type TasksCompletionResult = {
  range: RangePreset;
  from: string; // ISO date inclusive
  to: string; // ISO date inclusive (today in UTC)
  buckets: DayBucket[];
};

// Sprint 18.1 — completed vs. total tasks per day, last N days.
//
// "completed" = tasks whose status transition to 'completed' happened
// inside the range. Source-of-truth event: activity_log rows where
// action_type='task_approved' (the only path into status='completed').
// We pick the activity_log timestamp rather than tasks.updated_at because
// updated_at can be bumped by unrelated patches.
//
// "total" = tasks created on that day (activity_log action_type='task_created').
// This is what "total tasks per day in the range" naturally means;
// alternatively this could be "tasks in flight on that day" which is a
// much more expensive cumulative query — punt to later if needed.
//
// Filters:
//   departmentId    → joins activity_log → tasks via target_id and gates
//                     on tasks.department_id.
//   assigneeUserId  → ditto on tasks.assigned_to_user_id (legacy single-
//                     assignee column; multi-assignee join is fine here
//                     since the metric is "completion of a task" not
//                     "completion by a specific person").
//
// Cache: 5 minutes per (company, range, filter) tuple. The dashboard
// reloads on focus + every few minutes anyway, so a stale read is fine.

@Injectable()
export class TasksCompletionService {
  private static readonly DAYS_PER_RANGE: Record<RangePreset, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  constructor(private readonly cache: RedisCacheService) {}

  async compute(
    db: Prisma.TransactionClient,
    input: TasksCompletionInput,
  ): Promise<TasksCompletionResult> {
    const days = TasksCompletionService.DAYS_PER_RANGE[input.range];
    // Anchor the range on UTC midnight so the date buckets are stable
    // regardless of when this is called within a day. `from` is the start
    // of (today - days + 1), so "7d" returns 7 day-buckets including today.
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const fromMs = today - (days - 1) * 86_400_000;
    const from = new Date(fromMs);
    const toExclusive = new Date(today + 86_400_000); // upper bound for SQL

    const cacheKey = this.cacheKey(input, from, toExclusive);

    return this.cache.getOrSet<TasksCompletionResult>(cacheKey, 300, async () => {
      // Two parallel grouped counts: one for created events, one for
      // approved events. We join activity_log → tasks via target_id so
      // we can apply department/assignee filters on tasks columns.
      // Postgres handles the date_trunc grouping natively; an index on
      // (target_type, target_id, created_at) (Sprint 17's idx_activity_log_target
      // mirror on tasks side) keeps this fast.
      const [createdRows, approvedRows] = await Promise.all([
        this.groupByDay(db, input.companyId, 'task_created', from, toExclusive, input),
        this.groupByDay(db, input.companyId, 'task_approved', from, toExclusive, input),
      ]);

      // Build the day-by-day map so missing days appear as zeros.
      const buckets: DayBucket[] = [];
      const createdMap = new Map(createdRows.map((r) => [r.day, r.count]));
      const approvedMap = new Map(approvedRows.map((r) => [r.day, r.count]));
      for (let i = 0; i < days; i++) {
        const dayMs = fromMs + i * 86_400_000;
        const iso = new Date(dayMs).toISOString().slice(0, 10);
        buckets.push({
          date: iso,
          total: createdMap.get(iso) ?? 0,
          completed: approvedMap.get(iso) ?? 0,
        });
      }

      return {
        range: input.range,
        from: from.toISOString().slice(0, 10),
        to: new Date(today).toISOString().slice(0, 10),
        buckets,
      };
    });
  }

  // Runs ONE grouped count for a given action_type, applying optional
  // tasks-side filters via an inner join. Returns [{ day: 'YYYY-MM-DD', count }].
  private async groupByDay(
    db: Prisma.TransactionClient,
    companyId: string,
    actionType: 'task_created' | 'task_approved',
    from: Date,
    toExclusive: Date,
    filters: { departmentId?: string | null; assigneeUserId?: string | null },
  ): Promise<Array<{ day: string; count: number }>> {
    // Use Prisma.sql composition so filters are conditional but the SQL
    // stays parameterized. Postgres treats the empty conditions as
    // no-ops; we don't manually concatenate strings.
    const deptFilter = filters.departmentId
      ? Prisma.sql`AND t.department_id = ${filters.departmentId}::uuid`
      : Prisma.sql``;
    const assigneeFilter = filters.assigneeUserId
      ? Prisma.sql`AND t.assigned_to_user_id = ${filters.assigneeUserId}::uuid`
      : Prisma.sql``;

    const rows = await db.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT
        date_trunc('day', a.created_at AT TIME ZONE 'UTC') AS day,
        count(*)::bigint AS count
      FROM activity_log a
      JOIN tasks t ON t.id = a.target_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.action_type = ${actionType}
        AND a.target_type = 'task'
        AND a.created_at >= ${from}
        AND a.created_at <  ${toExclusive}
        ${deptFilter}
        ${assigneeFilter}
      GROUP BY day
    `);

    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }

  // The cache key is a short hash so a Manager filtering by department X
  // doesn't collide with the Admin's global view. Including the date
  // window in the key means a midnight rollover naturally invalidates.
  private cacheKey(input: TasksCompletionInput, from: Date, toExclusive: Date): string {
    const payload = JSON.stringify({
      v: 1, // bump if shape changes
      c: input.companyId,
      r: input.range,
      d: input.departmentId ?? null,
      a: input.assigneeUserId ?? null,
      f: from.toISOString().slice(0, 10),
      t: toExclusive.toISOString().slice(0, 10),
    });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:tasks-completion-by-day:${hash}`;
  }
}
