import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

class ActivityLogQuery {
  @IsOptional() @IsString() @Length(1, 50) entity_type?: string;
  @IsOptional() @IsUUID('4') entity_id?: string;
  @IsOptional() @IsUUID('4') actor_id?: string;

  // Date preset rather than free-form range — we'll add custom ranges in
  // Phase 2 per blueprint. Maps to a server-side window in days.
  @IsOptional()
  @IsIn(['today', '7d', '30d', '90d', '12m'])
  date_preset?: 'today' | '7d' | '30d' | '90d' | '12m';

  // Cursor for infinite scroll. Encoded as "<iso>|<uuid>" so the order
  // (createdAt DESC, id DESC) breaks ties deterministically. The client
  // round-trips whatever the server returned in the previous page's
  // nextCursor field.
  @IsOptional()
  @IsString()
  @Length(1, 100)
  cursor?: string;
}

type Row = {
  id: string;
  created_at: Date;
  actor_user_id: string | null;
  // Inlined so the UI can render "Burhan submitted a task" without a
  // follow-up users call. NULL when the actor is a deleted user or the
  // event is system-generated (e.g. Clerk webhook before the user row
  // exists).
  actor: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  field_changed: string | null;
  metadata: unknown;
};

const PAGE_SIZE = 50;

// GET /activity-log
//
// Role-scoped visibility (Sprint 17.4):
//   ceo / admin → all rows in the tenant
//   hr          → rows with target_type='user' (invites, role changes,
//                 sensitive-read audits, etc.)
//   manager     → rows where the ACTOR is in the manager's department
//   supervisor  → rows where the ACTOR is in any of the supervisor's teams
//   employee    → only rows where actor_user_id = me
//
// Tenant scope: RLS already restricts to my company. The visibility layer
// is applied on top in the WHERE clause.
//
// Filters & paging: filters AND together with the visibility clause.
// Cursor pagination by (created_at, id) DESC; max page size 100.

@Controller('activity-log')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class ActivityLogController {
  @Get()
  @RequirePermissions('activity_log.read')
  async list(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: ActivityLogQuery,
  ): Promise<{ items: Row[]; nextCursor: string | null }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, departmentId: true },
    });
    if (!me) throw new ForbiddenException('User not found');

    // 1. Build the role-scoped extra WHERE clause.
    const scopeWhere = await this.buildScopeWhere(db, tenant.userId, me);

    // 2. Decode cursor if provided. Shape: "<iso>|<uuid>".
    const cursorWhere = decodeCursor(q.cursor);

    // 3. Combine filters into a Prisma where + the scope.
    const where: Prisma.ActivityLogWhereInput = {
      ...(q.entity_type ? { targetType: q.entity_type } : {}),
      ...(q.entity_id ? { targetId: q.entity_id } : {}),
      ...(q.actor_id ? { actorUserId: q.actor_id } : {}),
      ...(q.date_preset ? { createdAt: { gte: presetToSince(q.date_preset) } } : {}),
      ...scopeWhere,
      ...cursorWhere,
    };

    // Take PAGE_SIZE+1 so we can tell whether another page exists without
    // a separate count query.
    const rows = await db.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const nextCursor =
      hasMore && items.length > 0
        ? `${items[items.length - 1].createdAt.toISOString()}|${items[items.length - 1].id}`
        : null;

    // Hydrate actor profiles in one batched lookup. Filter out null
    // actor_user_id (system-generated events).
    const actorIds = Array.from(
      new Set(items.map((r) => r.actorUserId).filter((id): id is string => !!id)),
    );
    const actors = actorIds.length
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return {
      items: items.map((r) => ({
        id: r.id,
        created_at: r.createdAt,
        actor_user_id: r.actorUserId,
        actor: r.actorUserId ? (actorById.get(r.actorUserId) ?? null) : null,
        action_type: r.actionType,
        target_type: r.targetType,
        target_id: r.targetId,
        field_changed: r.fieldChanged,
        metadata: r.metadata,
      })),
      nextCursor,
    };
  }

  // Translates the caller's org role into a Prisma WhereInput fragment.
  // Returns {} when no extra restriction is needed (admin/ceo).
  private async buildScopeWhere(
    db: Prisma.TransactionClient,
    selfUserId: string,
    me: { orgRole: string; departmentId: string | null },
  ): Promise<Prisma.ActivityLogWhereInput> {
    switch (me.orgRole) {
      case 'ceo':
      case 'admin':
        return {};

      case 'hr':
        // "user-related" = target_type='user'. Covers invites, role
        // grants, sensitive-field reads, profile edits, etc.
        return { targetType: 'user' };

      case 'manager': {
        // Events whose actor belongs to this manager's department.
        // We resolve the user list once and use IN — cheaper than a
        // correlated subquery on every audit row.
        if (!me.departmentId) return { actorUserId: selfUserId }; // no dept = see only own
        const peers = await db.user.findMany({
          where: { departmentId: me.departmentId, deletedAt: null },
          select: { id: true },
        });
        return { actorUserId: { in: peers.map((p) => p.id) } };
      }

      case 'supervisor': {
        // Events whose actor sits in any of MY teams. Same resolve-once
        // pattern: find my teams, then find users in those teams.
        const myTeams = await db.userTeam.findMany({
          where: { userId: selfUserId },
          select: { teamId: true },
        });
        if (myTeams.length === 0) return { actorUserId: selfUserId };
        const teammates = await db.userTeam.findMany({
          where: { teamId: { in: myTeams.map((t) => t.teamId) } },
          select: { userId: true },
        });
        return { actorUserId: { in: Array.from(new Set(teammates.map((t) => t.userId))) } };
      }

      case 'employee':
      default:
        return { actorUserId: selfUserId };
    }
  }
}

// Map a date preset to "since" (lower bound for createdAt).
function presetToSince(preset: 'today' | '7d' | '30d' | '90d' | '12m'): Date {
  const now = new Date();
  const days = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 }[preset];
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// "<iso>|<uuid>" → the "give me rows strictly older than this" clause.
// Returns {} on bad input so a corrupted cursor degrades to "page 1" rather
// than 500. Mirrors the orderBy (createdAt DESC, id DESC) — the row with
// the same createdAt but smaller id should appear AFTER the cursor row.
function decodeCursor(raw: string | undefined): Prisma.ActivityLogWhereInput {
  if (!raw) return {};
  const sep = raw.indexOf('|');
  if (sep === -1) return {};
  const iso = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return {};
  return {
    OR: [{ createdAt: { lt: ts } }, { AND: [{ createdAt: ts }, { id: { lt: id } }] }],
  };
}
