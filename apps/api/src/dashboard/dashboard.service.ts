import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

const OPEN_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'submitted',
  'reassignment_requested',
] as const;

export type EmployeeDashboardResult = {
  // Counts of my OPEN tasks broken down by status. Includes all five open
  // statuses so the UI always renders the same cards even on zero.
  activeByStatus: {
    draft: number;
    assigned: number;
    in_progress: number;
    submitted: number;
    reassignment_requested: number;
    /// Convenience total = sum of the five above.
    total: number;
  };
  // Up to 5 of my OPEN tasks with a due_date in the next 7 days
  // (inclusive of today and the 7th day). Soonest first.
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string;
  }>;
  // Up to 5 of my OPEN tasks whose due_date is in the past. Most overdue
  // first (oldest due date).
  overdue: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string;
    daysOverdue: number;
  }>;
  // Last 5 in-app notifications I've received. Includes read + unread.
  recentNotifications: Array<{
    id: string;
    type: string;
    title: string | null;
    body: string | null;
    link: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
  // Personal stats over the last 30 days. Same shape as
  // employee-performance for one user.
  stats: {
    assignedLast30: number;
    completedLast30: number;
    // Null when there are no completed-and-dated tasks in the window.
    onTimePctLast30: number | null;
  };
};

// Sprint 18.5 — Employee dashboard aggregation.
//
// All cards come from one bundle so the front-end makes ONE request.
// Cached per (company, user) for 60 seconds — the dashboard refetches
// on window focus anyway, and 60s keeps the cache hot enough that
// most page-loads are a Redis GET.

@Injectable()
export class DashboardService {
  constructor(private readonly cache: RedisCacheService) {}

  async employee(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<EmployeeDashboardResult> {
    const key = this.cacheKey(companyId, userId);
    return this.cache.getOrSet<EmployeeDashboardResult>(key, 60, async () => {
      // Run the five widget queries in parallel — none depend on each
      // other and they all hit different indexes.
      const [activeByStatus, upcomingDeadlines, overdue, recentNotifications, statsLast30] =
        await Promise.all([
          this.getActiveByStatus(db, companyId, userId),
          this.getUpcomingDeadlines(db, companyId, userId),
          this.getOverdue(db, companyId, userId),
          this.getRecentNotifications(db, userId),
          this.getStatsLast30(db, companyId, userId),
        ]);

      return {
        activeByStatus,
        upcomingDeadlines,
        overdue,
        recentNotifications,
        stats: statsLast30,
      };
    });
  }

  // Five-row count of open statuses for tasks where the user is an
  // assignee (multi-assignee join OR legacy column). UNION DISTINCT in
  // SQL keeps the per-status counts honest when a task has the user via
  // both routes.
  private async getActiveByStatus(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<EmployeeDashboardResult['activeByStatus']> {
    const rows = await db.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
      WITH my_open_tasks AS (
        SELECT DISTINCT t.id, t.status
        FROM tasks t
        WHERE t.company_id = ${companyId}::uuid
          AND t.deleted_at IS NULL
          AND t.status IN ('draft', 'assigned', 'in_progress', 'submitted', 'reassignment_requested')
          AND (
            t.assigned_to_user_id = ${userId}::uuid
            OR EXISTS (
              SELECT 1 FROM task_assignees ta
              WHERE ta.task_id = t.id AND ta.user_id = ${userId}::uuid
            )
          )
      )
      SELECT status::text AS status, count(*)::bigint AS count
      FROM my_open_tasks
      GROUP BY status
    `);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    const out = {
      draft: byStatus.draft ?? 0,
      assigned: byStatus.assigned ?? 0,
      in_progress: byStatus.in_progress ?? 0,
      submitted: byStatus.submitted ?? 0,
      reassignment_requested: byStatus.reassignment_requested ?? 0,
      total: 0,
    };
    out.total =
      out.draft + out.assigned + out.in_progress + out.submitted + out.reassignment_requested;
    return out;
  }

  // Open tasks with due_date in [today, today+7], soonest first, max 5.
  private async getUpcomingDeadlines(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<EmployeeDashboardResult['upcomingDeadlines']> {
    const today = todayUtc();
    const horizon = new Date(today.getTime() + 7 * 86_400_000);
    const rows = await db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        dueDate: { gte: today, lte: horizon },
        OR: [{ assignedToUserId: userId }, { assignees: { some: { userId } } }],
      },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: (r.dueDate as Date).toISOString().slice(0, 10),
    }));
  }

  // Open tasks with due_date < today, oldest-due first, max 5. We
  // compute daysOverdue in TS so the SQL stays simple.
  private async getOverdue(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<EmployeeDashboardResult['overdue']> {
    const today = todayUtc();
    const rows = await db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        dueDate: { lt: today },
        OR: [{ assignedToUserId: userId }, { assignees: { some: { userId } } }],
      },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    return rows.map((r) => {
      const due = r.dueDate as Date;
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        dueDate: due.toISOString().slice(0, 10),
        daysOverdue,
      };
    });
  }

  // Most recent 5 notifications for this user. Reuses Sprint 14's
  // notifications table. RLS scopes to the caller already.
  private async getRecentNotifications(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<EmployeeDashboardResult['recentNotifications']> {
    const rows = await db.notification.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // Personal stats over the last 30 days. Same definitions as
  // employee-performance (assigned = task created in the window where
  // the user is an assignee; completed = those tasks that have a
  // task_approved event; on-time = approved on or before due_date).
  // Single aggregated query rather than re-using the report service so
  // we don't pay for a separate cache key.
  private async getStatsLast30(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<EmployeeDashboardResult['stats']> {
    const today = todayUtc();
    const from = new Date(today.getTime() - 29 * 86_400_000);
    const toExclusive = new Date(today.getTime() + 86_400_000);

    const rows = await db.$queryRaw<
      Array<{
        assigned: bigint;
        completed: bigint;
        onTimeNumerator: bigint;
        onTimeDenominator: bigint;
      }>
    >(Prisma.sql`
      WITH my_eligible_tasks AS (
        SELECT t.id, t.due_date
        FROM tasks t
        WHERE t.company_id = ${companyId}::uuid
          AND t.deleted_at IS NULL
          AND t.created_at >= ${from}
          AND t.created_at <  ${toExclusive}
          AND (
            t.assigned_to_user_id = ${userId}::uuid
            OR EXISTS (
              SELECT 1 FROM task_assignees ta
              WHERE ta.task_id = t.id AND ta.user_id = ${userId}::uuid
            )
          )
      ),
      approval_event AS (
        SELECT a.target_id AS task_id, MIN(a.created_at) AS approved_at
        FROM activity_log a
        WHERE a.company_id = ${companyId}::uuid
          AND a.action_type = 'task_approved'
          AND a.target_type = 'task'
          AND a.target_id IN (SELECT id FROM my_eligible_tasks)
        GROUP BY a.target_id
      )
      SELECT
        COUNT(DISTINCT met.id) AS "assigned",
        COUNT(DISTINCT met.id) FILTER (WHERE ae.approved_at IS NOT NULL) AS "completed",
        COUNT(DISTINCT met.id) FILTER (
          WHERE ae.approved_at IS NOT NULL
            AND met.due_date IS NOT NULL
            AND ae.approved_at::date <= met.due_date
        ) AS "onTimeNumerator",
        COUNT(DISTINCT met.id) FILTER (
          WHERE ae.approved_at IS NOT NULL
            AND met.due_date IS NOT NULL
        ) AS "onTimeDenominator"
      FROM my_eligible_tasks met
      LEFT JOIN approval_event ae ON ae.task_id = met.id
    `);

    const r = rows[0];
    const num = Number(r?.onTimeNumerator ?? 0);
    const den = Number(r?.onTimeDenominator ?? 0);
    return {
      assignedLast30: Number(r?.assigned ?? 0),
      completedLast30: Number(r?.completed ?? 0),
      onTimePctLast30: den === 0 ? null : Math.round((num / den) * 1000) / 10,
    };
  }

  private cacheKey(companyId: string, userId: string): string {
    const payload = JSON.stringify({ v: 1, c: companyId, u: userId });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:dashboard:employee:${hash}`;
  }
}

function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
