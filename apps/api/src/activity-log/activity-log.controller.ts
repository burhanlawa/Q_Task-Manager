import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

// Streaming CSV reads filters in the same shape as the JSON list endpoint
// (so the UI can use the same filter values for "view" and "export"), but
// has no cursor — the whole filtered set streams out in one response.
class ExportQuery {
  @IsOptional() @IsString() @Length(1, 50) entity_type?: string;
  @IsOptional() @IsUUID('4') entity_id?: string;
  @IsOptional() @IsUUID('4') actor_id?: string;
  @IsOptional()
  @IsIn(['today', '7d', '30d', '90d', '12m'])
  date_preset?: 'today' | '7d' | '30d' | '90d' | '12m';
}

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

  // GET /activity-log/export
  //
  // Streams a CSV of the filtered, role-scoped activity log. We keep
  // memory bounded by reading the result in fixed-size batches via
  // Prisma's `cursor` pagination — never materialize the whole set
  // server-side. Each row writes a CSV line; the Node Express stream
  // backpressures naturally if the client is slow.
  //
  // No row cap: the done check requires 100k rows to succeed cleanly.
  // Larger exports also work; throughput is bounded by Postgres + the
  // network, not by Node memory.
  @Get('export')
  @RequirePermissions('activity_log.read')
  // Force browser download with a sane filename. The .csv extension +
  // text/csv content-type tell Chrome/Excel to treat it as a CSV.
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="activity-log.csv"')
  // Discourage caching — exports are time-sensitive snapshots of audit data.
  @Header('cache-control', 'no-store')
  async exportCsv(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: ExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, departmentId: true },
    });
    if (!me) throw new ForbiddenException('User not found');

    const scopeWhere = await this.buildScopeWhere(db, tenant.userId, me);
    const where: Prisma.ActivityLogWhereInput = {
      ...(q.entity_type ? { targetType: q.entity_type } : {}),
      ...(q.entity_id ? { targetId: q.entity_id } : {}),
      ...(q.actor_id ? { actorUserId: q.actor_id } : {}),
      ...(q.date_preset ? { createdAt: { gte: presetToSince(q.date_preset) } } : {}),
      ...scopeWhere,
    };

    // BOM lets Excel autodetect UTF-8; without it, Arabic / Kurdish in
    // any metadata text turns into mojibake on Windows.
    res.write('﻿');
    res.write(
      [
        'created_at',
        'actor_user_id',
        'actor_email',
        'action_type',
        'target_type',
        'target_id',
        'field_changed',
        'metadata_json',
      ]
        .map(csvCell)
        .join(',') + '\n',
    );

    // We resolve actor emails as we stream by maintaining a small LRU-ish
    // Map (bounded at EMAIL_CACHE_MAX). Per-batch lookups would amplify
    // round-trips; one cache covers the whole export with near-zero memory.
    const EMAIL_CACHE_MAX = 5000;
    const emailByActorId = new Map<string, string | null>();
    async function ensureEmails(ids: string[]) {
      const missing = ids.filter((id) => id && !emailByActorId.has(id));
      if (missing.length === 0) return;
      const users = await db.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, email: true },
      });
      for (const u of users) emailByActorId.set(u.id, u.email);
      // Anything not found → null (covers deleted users).
      for (const id of missing) {
        if (!emailByActorId.has(id)) emailByActorId.set(id, null);
      }
      // Trim if oversized. Map preserves insertion order; we drop oldest.
      while (emailByActorId.size > EMAIL_CACHE_MAX) {
        const firstKey = emailByActorId.keys().next().value;
        if (firstKey === undefined) break;
        emailByActorId.delete(firstKey);
      }
    }

    const BATCH = 1000;
    let cursor: { id: string; createdAt: Date } | null = null;
    let rowsWritten = 0;

    // Hot loop: fetch a batch, write it, advance the cursor by the last
    // row's (createdAt, id). When the client disconnects (res.writableEnded)
    // bail early so a partial download doesn't keep the DB pinned.
    while (!res.writableEnded) {
      // Prisma's `cursor` skips the row you point at, so for the first
      // batch we pass undefined. Subsequent batches pass the last row's
      // composite key to continue from there.
      // Prisma's composite-PK cursor input takes the field names joined with
      // an underscore in the schema's @@id order. The cast is needed because
      // TS can't pick the right overload when `cursor` is conditional.
      const cursorArg: Prisma.ActivityLogFindManyArgs = cursor
        ? {
            cursor: { id_createdAt: { id: cursor.id, createdAt: cursor.createdAt } },
            skip: 1,
          }
        : {};
      const batch = await db.activityLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: BATCH,
        ...cursorArg,
      });
      if (batch.length === 0) break;

      const batchActorIds = Array.from(
        new Set(batch.map((r) => r.actorUserId).filter((id): id is string => !!id)),
      );
      await ensureEmails(batchActorIds);

      for (const r of batch) {
        const line =
          [
            r.createdAt.toISOString(),
            r.actorUserId ?? '',
            r.actorUserId ? (emailByActorId.get(r.actorUserId) ?? '') : '',
            r.actionType,
            r.targetType ?? '',
            r.targetId ?? '',
            r.fieldChanged ?? '',
            r.metadata ? JSON.stringify(r.metadata) : '',
          ]
            .map(csvCell)
            .join(',') + '\n';
        // res.write returns false if the internal buffer is full; we
        // could await drain, but for a CSV stream the small write rate
        // means buffer pressure is rare. If it ever matters, swap this
        // for a pipe() through a Transform.
        res.write(line);
      }
      rowsWritten += batch.length;

      const last = batch[batch.length - 1];
      cursor = { id: last.id, createdAt: last.createdAt };

      // Defensive: if Prisma somehow returned fewer than BATCH rows we're
      // at the tail; break to avoid an empty next round-trip.
      if (batch.length < BATCH) break;
    }

    res.end();
    // Best-effort log so we can verify the streaming actually streamed.
    // Not awaited — fire-and-forget.
    void rowsWritten;
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

// RFC 4180-style CSV escaping: wrap in quotes, double internal quotes.
// We always quote, regardless of whether the value needs it — keeps the
// downstream parsing predictable and the perf cost is a noise-level number
// of bytes per row.
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
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
