import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';

// Sprint 18.6 — Manager-tier dashboard.
//
// One endpoint, four roles share it with different visibility:
//   CEO/Admin   → company-wide (no scope filter)
//   HR/Manager  → their own department
//   Supervisor  → users in their team(s)
//   Employee    → 403 (the controller's permission gate stops them)
//
// Scope resolution happens HERE in the service, not in the controller, so
// the SQL filters and the cache key agree. The cache key includes the
// resolved scope shape so two roles with overlapping data don't collide.

export type ManagerDashboardScope =
  | { kind: 'company' } // CEO / Admin
  | { kind: 'department'; id: string } // HR / Manager
  | { kind: 'teams'; ids: string[] }; // Supervisor

export type ManagerDashboardInput = {
  companyId: string;
  callerUserId: string;
  callerOrgRole: string;
  callerDepartmentId: string | null;
};

export type ManagerDashboardResult = {
  scope: { kind: ManagerDashboardScope['kind'] };
  // Aggregate of all tasks in scope by status.
  taskOverview: {
    total: number;
    byStatus: Record<string, number>;
  };
  // For HR/Manager/CEO: one row per team in scope. For Supervisor: just
  // their team(s). Each row has open vs. completed-last-30-days counts.
  teamComparison: Array<{
    teamId: string;
    teamName: string;
    openCount: number;
    completedLast30: number;
  }>;
  // Open tasks in scope with the soonest due_date; max 8.
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string;
    assigneeName: string | null;
  }>;
  // Top assignees by weighted load (same formula as Sprint 18.3), max 10.
  workloadTop: Array<{
    userId: string;
    displayName: string | null;
    openCount: number;
    weightedLoad: number;
  }>;
  // Onboarding approvals visible in this scope. Counts only; the CTA on
  // the page links to /onboarding/approvals where row-level filtering
  // happens per-user.
  pendingApprovals: number;
};

@Injectable()
export class ManagerDashboardService {
  constructor(private readonly cache: RedisCacheService) {}

  async run(
    db: Prisma.TransactionClient,
    input: ManagerDashboardInput,
  ): Promise<ManagerDashboardResult> {
    const scope = await this.resolveScope(db, input);
    const key = this.cacheKey(input.companyId, scope);

    return this.cache.getOrSet<ManagerDashboardResult>(key, 60, async () => {
      const [taskOverview, teamComparison, upcomingDeadlines, workloadTop, pendingApprovals] =
        await Promise.all([
          this.getTaskOverview(db, input.companyId, scope),
          this.getTeamComparison(db, input.companyId, scope),
          this.getUpcomingDeadlines(db, input.companyId, scope),
          this.getWorkloadTop(db, input.companyId, scope),
          this.getPendingApprovals(db, input.companyId),
        ]);

      return {
        scope: { kind: scope.kind },
        taskOverview,
        teamComparison,
        upcomingDeadlines,
        workloadTop,
        pendingApprovals,
      };
    });
  }

  // Resolve the caller's role + their org slot into a scope. Supervisor
  // with no teams gets an empty teams scope — the SQL filters then
  // return zeros across the board, which is the right zero-state.
  private async resolveScope(
    db: Prisma.TransactionClient,
    input: ManagerDashboardInput,
  ): Promise<ManagerDashboardScope> {
    const role = input.callerOrgRole;
    if (role === 'ceo' || role === 'admin') return { kind: 'company' };
    if (role === 'hr' || role === 'manager') {
      // HR uses "company-wide on user-related things" but for THIS
      // dashboard the manager view is more useful for both, so HR sees
      // their dept too. The spec calls this "appropriate filtering."
      if (!input.callerDepartmentId) return { kind: 'teams', ids: [] };
      return { kind: 'department', id: input.callerDepartmentId };
    }
    if (role === 'supervisor') {
      const memberships = await db.userTeam.findMany({
        where: { userId: input.callerUserId },
        select: { teamId: true },
      });
      return { kind: 'teams', ids: memberships.map((m) => m.teamId) };
    }
    // Anything else (employee, unknown) → no data. The controller
    // rejects employee before we get here, but defense in depth.
    return { kind: 'teams', ids: [] };
  }

  // Build the "this task is in my scope" SQL fragment, applied to the
  // tasks table aliased `t`. For supervisor (teams scope) the answer is
  // "the task's team_id is one of mine OR any assignee belongs to one
  // of my teams." Easier: any task whose team_id is one of mine.
  private scopeWhere(scope: ManagerDashboardScope): Prisma.Sql {
    switch (scope.kind) {
      case 'company':
        // Prisma.empty is the documented zero-length SQL fragment. An
        // empty Prisma.sql`` template renders inconsistently across pg
        // driver versions and is a known cause of parameter-binding bugs
        // when nested inside another sql template.
        return Prisma.empty;
      case 'department':
        return Prisma.sql`AND t.department_id = ${scope.id}::uuid`;
      case 'teams':
        if (scope.ids.length === 0) return Prisma.sql`AND FALSE`;
        return Prisma.sql`AND t.team_id IN (${Prisma.join(
          scope.ids.map((id) => Prisma.sql`${id}::uuid`),
        )})`;
    }
  }

  private async getTaskOverview(
    db: Prisma.TransactionClient,
    companyId: string,
    scope: ManagerDashboardScope,
  ): Promise<ManagerDashboardResult['taskOverview']> {
    const scopeSql = this.scopeWhere(scope);
    const rows = await db.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
      SELECT t.status::text AS status, count(*)::bigint AS count
      FROM tasks t
      WHERE t.company_id = ${companyId}::uuid
        AND t.deleted_at IS NULL
        ${scopeSql}
      GROUP BY t.status
    `);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { total, byStatus };
  }

  // One row per team in scope. For company scope we cap at the top 10
  // teams by open count so a 100-team tenant doesn't blow up the page.
  private async getTeamComparison(
    db: Prisma.TransactionClient,
    companyId: string,
    scope: ManagerDashboardScope,
  ): Promise<ManagerDashboardResult['teamComparison']> {
    const scopeSql = this.scopeWhere(scope);
    // Teams considered: any team that owns at least one non-deleted task
    // in scope. We compute open vs. completed-last-30 in one pass via
    // count(*) FILTER.
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db.$queryRaw<
      Array<{
        teamId: string;
        teamName: string;
        openCount: bigint;
        completedLast30: bigint;
      }>
    >(Prisma.sql`
      SELECT
        team.id                                                                   AS "teamId",
        team.name                                                                 AS "teamName",
        COUNT(*) FILTER (
          WHERE t.status IN ('draft','assigned','in_progress','submitted','reassignment_requested')
        )::bigint                                                                 AS "openCount",
        COUNT(*) FILTER (
          WHERE t.status = 'completed'
            AND t.updated_at >= ${since}
        )::bigint                                                                 AS "completedLast30"
      FROM tasks t
      JOIN teams team ON team.id = t.team_id
      WHERE t.company_id = ${companyId}::uuid
        AND t.deleted_at IS NULL
        AND t.team_id IS NOT NULL
        ${scopeSql}
      GROUP BY team.id, team.name
      ORDER BY "openCount" DESC, team.name ASC
      LIMIT 10
    `);
    return rows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      openCount: Number(r.openCount),
      completedLast30: Number(r.completedLast30),
    }));
  }

  // Open tasks with a due_date set, soonest first, max 8. We include
  // the legacy single-assignee display name when available so the UI
  // can show "due Fri — to Sara" without a follow-up call.
  private async getUpcomingDeadlines(
    db: Prisma.TransactionClient,
    companyId: string,
    scope: ManagerDashboardScope,
  ): Promise<ManagerDashboardResult['upcomingDeadlines']> {
    const scopeSql = this.scopeWhere(scope);
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        title: string;
        status: string;
        priority: string;
        dueDate: Date;
        assigneeName: string | null;
      }>
    >(Prisma.sql`
      SELECT
        t.id,
        t.title,
        t.status::text AS status,
        t.priority::text AS priority,
        t.due_date AS "dueDate",
        u.display_name AS "assigneeName"
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to_user_id
      WHERE t.company_id = ${companyId}::uuid
        AND t.deleted_at IS NULL
        AND t.due_date IS NOT NULL
        AND t.status IN ('draft','assigned','in_progress','submitted','reassignment_requested')
        ${scopeSql}
      ORDER BY t.due_date ASC, t.id ASC
      LIMIT 8
    `);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate.toISOString().slice(0, 10),
      assigneeName: r.assigneeName,
    }));
  }

  // Top 10 users by weighted load within scope. Same weights and
  // assignee-union pattern as Sprint 18.3.
  private async getWorkloadTop(
    db: Prisma.TransactionClient,
    companyId: string,
    scope: ManagerDashboardScope,
  ): Promise<ManagerDashboardResult['workloadTop']> {
    const scopeSql = this.scopeWhere(scope);
    const rows = await db.$queryRaw<
      Array<{
        userId: string;
        displayName: string | null;
        openCount: bigint;
        weightedLoad: bigint;
      }>
    >(Prisma.sql`
      WITH open_tasks AS (
        SELECT t.id, t.priority, t.assigned_to_user_id
        FROM tasks t
        WHERE t.company_id = ${companyId}::uuid
          AND t.deleted_at IS NULL
          AND t.status IN ('draft','assigned','in_progress','submitted','reassignment_requested')
          ${scopeSql}
      ),
      pairs AS (
        SELECT ot.id AS task_id, ot.priority, ta.user_id
        FROM open_tasks ot
        JOIN task_assignees ta ON ta.task_id = ot.id
        UNION
        SELECT ot.id AS task_id, ot.priority, ot.assigned_to_user_id AS user_id
        FROM open_tasks ot
        WHERE ot.assigned_to_user_id IS NOT NULL
      )
      SELECT
        u.id           AS "userId",
        u.display_name AS "displayName",
        COUNT(DISTINCT p.task_id)::bigint AS "openCount",
        SUM(
          CASE p.priority
            WHEN 'low'    THEN 1
            WHEN 'medium' THEN 2
            WHEN 'high'   THEN 3
            WHEN 'urgent' THEN 4
            ELSE 0
          END
        )::bigint AS "weightedLoad"
      FROM pairs p
      JOIN users u ON u.id = p.user_id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, u.display_name
      ORDER BY "weightedLoad" DESC, "openCount" DESC, u.display_name ASC
      LIMIT 10
    `);
    return rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      openCount: Number(r.openCount),
      weightedLoad: Number(r.weightedLoad),
    }));
  }

  // Tenant-wide pending approvals count. The card links the user to
  // /onboarding/approvals where the existing UI shows only the rows
  // they can act on (the chain.json carries per-step user/role info).
  private async getPendingApprovals(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<number> {
    return db.userInvitationApproval.count({
      where: { companyId, status: 'pending' },
    });
  }

  private cacheKey(companyId: string, scope: ManagerDashboardScope): string {
    const payload = JSON.stringify({ v: 1, c: companyId, s: scope });
    const hash = createHash('sha1').update(payload).digest('hex').slice(0, 16);
    return `cache:dashboard:manager:${hash}`;
  }
}
