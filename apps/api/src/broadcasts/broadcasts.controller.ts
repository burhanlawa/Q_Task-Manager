import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { AudienceResolverService, type AudienceKind } from './audience-resolver.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

// Shape returned by GET /broadcasts list endpoint. Same envelope for both
// sent + received so the UI can use one row component.
type BroadcastListItem = {
  id: string;
  title: string;
  body: string;
  audience: string;
  audienceSize: number | null;
  sender: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  createdAt: string;
};

// Role → allowed audience kinds for THIS sprint (16.4). The web picker
// mirrors this list; the controller enforces it. Kept in one place so the
// two layers can never drift.
//   ceo / hr / admin → full picker
//   manager          → their department (and teams in it, by id)
//   supervisor       → their team(s) only
//   employee         → no broadcast.send permission, so never reaches here
const ALLOWED_AUDIENCES_BY_ROLE: Record<string, ReadonlySet<AudienceKind>> = {
  ceo: new Set(['company', 'all_company', 'branch', 'department', 'team', 'role', 'custom']),
  hr: new Set(['company', 'all_company', 'branch', 'department', 'team', 'role', 'custom']),
  admin: new Set(['company', 'all_company', 'branch', 'department', 'team', 'role', 'custom']),
  manager: new Set(['department', 'team', 'custom']),
  supervisor: new Set(['team', 'custom']),
  // employee gets the empty set; broadcast.send permission gate stops them
  // before this anyway, but defense in depth.
  employee: new Set(),
};

// POST /broadcasts — create + fan out in one shot.
//
// Flow:
//   1. Insert the broadcast row (the source-of-truth for "the company sent
//      this announcement").
//   2. Resolve the audience to a user_id list. Empty audience is allowed
//      (e.g., a custom filter to a now-deleted user) — the row stays so
//      the sender's record is preserved.
//   3. For each recipient, write a notification row via NotificationsService.
//      That writer already handles in-app vs. email channel routing through
//      user_notification_preferences and enqueues emails via BullMQ.
//   4. Record an activity_log entry for audit.
//
// Fan-out shape: we loop INLINE in the request handler. Sprint 16.x can
// move to a BullMQ broadcast-fanout queue once we see real tenants with
// 1000+ users; for now this matches the existing inline pattern for task
// assignment fan-out (tasks.controller.ts) and is the simpler thing.

@Controller('broadcasts')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class BroadcastsController {
  constructor(
    private readonly resolver: AudienceResolverService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityLogService,
  ) {}

  // GET /broadcasts/audience-options
  //   Lets the composer UI render only the choices the caller is allowed
  //   to pick, plus the scoped lists they can target (their own dept, their
  //   own teams). The picker still POSTs an audience+target_ids; this
  //   endpoint just describes what the picker should LOOK like.
  @Get('audience-options')
  @RequirePermissions('broadcast.send')
  async audienceOptions(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{
    role: string;
    allowed: AudienceKind[];
    myDepartmentId: string | null;
    myBranchId: string | null;
    myTeamIds: string[];
  }> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, departmentId: true, branchId: true },
    });
    if (!me) throw new ForbiddenException('User not found');
    const myTeams = await db.userTeam.findMany({
      where: { userId: tenant.userId },
      select: { teamId: true },
    });
    const allowed = ALLOWED_AUDIENCES_BY_ROLE[me.orgRole] ?? new Set<AudienceKind>();
    return {
      role: me.orgRole,
      allowed: Array.from(allowed),
      myDepartmentId: me.departmentId,
      myBranchId: me.branchId,
      myTeamIds: myTeams.map((t) => t.teamId),
    };
  }

  // GET /broadcasts
  //   Two lists in one payload: 'sent' (broadcasts I authored) and
  //   'received' (broadcasts whose fan-out landed a notification row in
  //   my inbox). Both newest-first, deleted rows excluded.
  //
  //   audienceSize comes from the activity_log metadata we wrote at send
  //   time — that's the canonical count from when fan-out ran, not a
  //   re-resolution against today's org structure (which could lie if the
  //   audience changed since).
  @Get()
  async list(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{
    sent: BroadcastListItem[];
    received: BroadcastListItem[];
  }> {
    const [sentRows, receivedRows] = await Promise.all([
      db.broadcast.findMany({
        where: { senderUserId: tenant.userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // 'Received by me' = there's a notification row for me whose
      // sourceTargetType='broadcast' and sourceTargetId points at the
      // broadcast. We join through DB rather than re-resolving the
      // audience because (a) it survives audience changes, and (b) it
      // honors per-user opt-outs from the prefs (which the resolver
      // doesn't filter for).
      db.notification.findMany({
        where: {
          userId: tenant.userId,
          sourceTargetType: 'broadcast',
        },
        select: { sourceTargetId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const receivedIds = Array.from(
      new Set(receivedRows.map((r) => r.sourceTargetId).filter((id): id is string => !!id)),
    );
    const received = receivedIds.length
      ? await db.broadcast.findMany({
          where: { id: { in: receivedIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const broadcastIds = [...sentRows.map((b) => b.id), ...received.map((b) => b.id)];
    const senderIds = Array.from(
      new Set(
        [...sentRows, ...received].map((b) => b.senderUserId).filter((id): id is string => !!id),
      ),
    );

    // Two lookups in parallel: audience-size metadata + sender display info.
    const [activityRows, senders] = await Promise.all([
      broadcastIds.length
        ? db.activityLog.findMany({
            where: { targetType: 'broadcast', targetId: { in: broadcastIds } },
            select: { targetId: true, metadata: true },
          })
        : [],
      senderIds.length
        ? db.user.findMany({
            where: { id: { in: senderIds } },
            select: { id: true, displayName: true, firstName: true, lastName: true, email: true },
          })
        : [],
    ]);
    const sizeByBroadcastId = new Map<string, number>();
    for (const a of activityRows) {
      const meta = (a.metadata ?? {}) as { recipientCount?: number };
      if (typeof meta.recipientCount === 'number') {
        sizeByBroadcastId.set(a.targetId!, meta.recipientCount);
      }
    }
    const senderById = new Map(senders.map((s) => [s.id, s]));

    const shape = (b: (typeof sentRows)[number]): BroadcastListItem => ({
      id: b.id,
      title: b.title,
      body: b.body,
      audience: b.audience,
      audienceSize: sizeByBroadcastId.get(b.id) ?? null,
      sender: b.senderUserId ? (senderById.get(b.senderUserId) ?? null) : null,
      createdAt: b.createdAt.toISOString(),
    });

    return {
      sent: sentRows.map(shape),
      received: received.map(shape),
    };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('broadcast.send')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateBroadcastDto,
  ): Promise<{
    id: string;
    audience: AudienceKind;
    recipientCount: number;
    notifiedCount: number;
  }> {
    const filter = dto.audience_filter ?? {};

    // 1. Role-scope gate (16.4). Even if the picker is set up right, the
    //    server is the actual security boundary — a Supervisor can't POST
    //    audience=company by bypassing the UI.
    await this.enforceRoleScope(db, tenant, dto, filter);

    // Resolve first so a misconfigured audience (e.g. branch with no
    // target_ids) errors BEFORE we write the broadcast row.
    const recipientIds = await this.resolver.resolve(db, tenant.companyId, dto.audience, filter);

    // 'company' is the new spec name; the underlying enum value is still
    // 'all_company' (preserved so existing rows keep their meaning).
    const audienceEnum = dto.audience === 'company' ? 'all_company' : dto.audience;

    const broadcast = await db.broadcast.create({
      data: {
        companyId: tenant.companyId,
        senderUserId: tenant.userId,
        title: dto.title,
        body: dto.body,
        audience: audienceEnum,
        audienceFilter: filter as Prisma.InputJsonValue,
      },
    });

    // Fan-out. NotificationsService is responsible for:
    //   - reading user_notification_preferences (gates in-app + email)
    //   - inserting the per-user notification row
    //   - firing Pusher real-time for the bell
    //   - enqueueing the email job when prefs allow
    let notifiedCount = 0;
    for (const recipientId of recipientIds) {
      const result = await this.notifications.create(db, {
        recipientId,
        companyId: tenant.companyId,
        type: 'broadcast',
        title: dto.title,
        message: dto.body,
        relatedEntityType: 'broadcast',
        relatedEntityId: broadcast.id,
        actionUrl: `/broadcasts/${broadcast.id}`,
        actorUserId: tenant.userId,
        metadata: {
          title: dto.title,
          messageBody: dto.body,
          audience: dto.audience,
        },
      });
      if (result) notifiedCount++;
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'broadcast_sent',
      targetType: 'broadcast',
      targetId: broadcast.id,
      metadata: {
        audience: dto.audience,
        recipientCount: recipientIds.length,
        notifiedCount,
      },
    });

    return {
      id: broadcast.id,
      audience: dto.audience,
      recipientCount: recipientIds.length,
      notifiedCount,
    };
  }

  // Role-scope enforcement. Two checks:
  //   a) The audience KIND must be in the role's allow-list (e.g. supervisor
  //      can't pick 'company').
  //   b) For scoped roles, the TARGET_IDS must lie within the sender's own
  //      scope. Manager can pick department but only THEIR department;
  //      Supervisor can pick team but only THEIR team. Custom is constrained
  //      to users inside that same scope.
  private async enforceRoleScope(
    db: Prisma.TransactionClient,
    tenant: TenantContext,
    dto: CreateBroadcastDto,
    filter: { target_ids?: string[]; branch_id?: string; role_id?: string; user_ids?: string[] },
  ): Promise<void> {
    const me = await db.user.findUnique({
      where: { id: tenant.userId },
      select: { orgRole: true, departmentId: true, branchId: true },
    });
    if (!me) throw new ForbiddenException('User not found');

    const allowed = ALLOWED_AUDIENCES_BY_ROLE[me.orgRole] ?? new Set<AudienceKind>();
    if (!allowed.has(dto.audience)) {
      throw new ForbiddenException(
        `Your role (${me.orgRole}) cannot send to audience '${dto.audience}'`,
      );
    }

    // Unbounded roles (CEO/HR/Admin) can target anything in the tenant.
    if (me.orgRole === 'ceo' || me.orgRole === 'hr' || me.orgRole === 'admin') return;

    // Collect the target_ids from either the new shape or the 16.2 legacy
    // keys; the resolver does the same.
    const ids =
      filter.target_ids ?? (filter.branch_id ? [filter.branch_id] : null) ?? filter.user_ids ?? [];

    if (me.orgRole === 'manager') {
      // Manager: department restricted to THEIR department; team restricted
      // to teams inside their department; custom restricted to users in
      // their department.
      if (dto.audience === 'department') {
        if (!me.departmentId || !ids.every((id) => id === me.departmentId)) {
          throw new ForbiddenException('Managers can only broadcast to their own department');
        }
        return;
      }
      if (dto.audience === 'team') {
        if (!me.departmentId) throw new ForbiddenException('Manager has no department');
        const teams = await db.team.findMany({
          where: { id: { in: ids }, departmentId: me.departmentId },
          select: { id: true },
        });
        if (teams.length !== ids.length) {
          throw new ForbiddenException(
            'Managers can only broadcast to teams inside their own department',
          );
        }
        return;
      }
      if (dto.audience === 'custom') {
        if (!me.departmentId) throw new ForbiddenException('Manager has no department');
        const users = await db.user.findMany({
          where: { id: { in: ids }, departmentId: me.departmentId },
          select: { id: true },
        });
        if (users.length !== ids.length) {
          throw new ForbiddenException(
            'Managers can only broadcast to users in their own department',
          );
        }
        return;
      }
    }

    if (me.orgRole === 'supervisor') {
      // Supervisor: team restricted to their team(s); custom restricted to
      // members of their team(s).
      const myTeams = await db.userTeam.findMany({
        where: { userId: tenant.userId },
        select: { teamId: true },
      });
      const myTeamIds = new Set(myTeams.map((t) => t.teamId));
      if (myTeamIds.size === 0) {
        throw new ForbiddenException('Supervisor has no team assignments');
      }
      if (dto.audience === 'team') {
        if (!ids.every((id) => myTeamIds.has(id))) {
          throw new ForbiddenException('Supervisors can only broadcast to their own team(s)');
        }
        return;
      }
      if (dto.audience === 'custom') {
        const memberships = await db.userTeam.findMany({
          where: { userId: { in: ids }, teamId: { in: Array.from(myTeamIds) } },
          select: { userId: true },
        });
        const reachable = new Set(memberships.map((m) => m.userId));
        if (!ids.every((id) => reachable.has(id))) {
          throw new ForbiddenException(
            'Supervisors can only broadcast to users in their own team(s)',
          );
        }
        return;
      }
    }
  }
}
