import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { ReassignmentDecision, ReassignmentDecisionDto } from './dto/reassignment-decision.dto';
import { RequestReassignmentDto } from './dto/request-reassignment.dto';

// Sprint 8.7 — reassignment request flow (v2.0 addition).
//
// Lifecycle:
//   1. An assignee POSTs /request-reassignment with a reason.
//      - Task status (assigned|in_progress) is captured into `previous_status`.
//      - Task moves to 'reassignment_requested', tasks.reassignment_request_count++.
//      - A row in task_reassignment_requests is inserted with status='pending'.
//      - Partial unique index `(task_id) WHERE status='pending'` prevents duplicates.
//   2. The assigner (task creator OR holder of `task.assign`) POSTs
//      /reassignment-decision with 'approved' | 'rejected' and an optional note.
//      - On approve: status → 'draft', the requester's task_assignees row is
//        removed (so the task is unowned and an assigner can pick it back up).
//      - On reject: status → previous_status (back to where we were).
//      - Either way, the request row gets decided_by_user_id, decided_at,
//        decision_note, and its status flipped to 'approved'/'rejected'.

@Controller('tasks')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class TaskReassignmentController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly activity: ActivityLogService,
  ) {}

  // Returns the pending reassignment request for a task, if any, plus a
  // small profile for the requester so the assigner-side UI can show who
  // asked and why without making a follow-up users call.
  @Get(':id/reassignment-requests/pending')
  async pending(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const request = await db.taskReassignmentRequest.findFirst({
      where: { taskId: id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!request) return { request: null, requester: null };
    const requester = await db.user.findUnique({
      where: { id: request.requestedByUserId },
      select: { id: true, displayName: true, firstName: true, lastName: true, email: true },
    });
    return { request, requester };
  }

  @Post(':id/request-reassignment')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async request(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestReassignmentDto,
  ) {
    const task = await db.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        assignedToUserId: true,
        createdByUserId: true,
      },
    });
    if (!task || task.deletedAt) throw new NotFoundException('Task not found');

    // Must be an assignee.
    const isAssignee =
      task.assignedToUserId === tenant.userId ||
      !!(await db.taskAssignee.findUnique({
        where: { taskId_userId: { taskId: task.id, userId: tenant.userId } },
        select: { taskId: true },
      }));
    if (!isAssignee) {
      throw new ForbiddenException('Only an assignee can request reassignment');
    }

    // Status must be in an active state (assigned or in_progress). The partial
    // unique index also blocks a second pending request, but checking status
    // first gives a clearer error.
    if (task.status !== 'assigned' && task.status !== 'in_progress') {
      throw new ConflictException(
        `Cannot request reassignment for a task in status '${task.status}'`,
      );
    }

    // Insert the request row, capturing the status to restore on reject.
    let request;
    try {
      request = await db.taskReassignmentRequest.create({
        data: {
          companyId: tenant.companyId,
          taskId: task.id,
          requestedByUserId: tenant.userId,
          reason: dto.reason,
          previousStatus: task.status,
          status: 'pending',
        },
      });
    } catch (e) {
      // Partial unique index collision → another pending request already exists.
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('A pending reassignment request already exists for this task');
      }
      throw e;
    }

    await db.task.update({
      where: { id: task.id },
      data: {
        status: 'reassignment_requested',
        reassignmentRequestCount: { increment: 1 },
      },
    });

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'task_reassignment_requested',
      targetType: 'task',
      targetId: task.id,
      metadata: {
        requestId: request.id,
        from: task.status,
        to: 'reassignment_requested',
        reason: dto.reason,
      },
    });

    return { task: await this.reloadTask(db, task.id), request };
  }

  @Post(':id/reassignment-decision')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async decide(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReassignmentDecisionDto,
  ) {
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true, createdByUserId: true },
    });
    if (!task || task.deletedAt) throw new NotFoundException('Task not found');

    // Gate: creator OR has task.assign.
    if (task.createdByUserId !== tenant.userId) {
      const granted = await this.permissions.getEffectivePermissions(tenant.userId);
      if (!this.permissions.has(granted, 'task.assign')) {
        throw new ForbiddenException(
          "Only the task creator or a user with 'task.assign' can decide reassignment requests",
        );
      }
    }

    // Find the active (pending) request.
    const request = await db.taskReassignmentRequest.findFirst({
      where: { taskId: task.id, status: 'pending' },
    });
    if (!request) throw new NotFoundException('No pending reassignment request for this task');
    if (task.status !== 'reassignment_requested') {
      // Defensive — state machine should keep these aligned, but be explicit.
      throw new ConflictException(
        `Task status '${task.status}' is inconsistent with a pending reassignment request`,
      );
    }

    if (dto.decision === ReassignmentDecision.approved) {
      // Clear the requesting user from task_assignees (if present) and from
      // the legacy single-assignee column if it matches.
      await db.taskAssignee.deleteMany({
        where: { taskId: task.id, userId: request.requestedByUserId },
      });
      const taskRow = await db.task.findUnique({
        where: { id: task.id },
        select: { assignedToUserId: true },
      });
      const data: Prisma.TaskUncheckedUpdateInput = { status: 'draft' };
      if (taskRow?.assignedToUserId === request.requestedByUserId) {
        data.assignedToUserId = null;
      }
      await db.task.update({ where: { id: task.id }, data });
    } else if (dto.decision === ReassignmentDecision.rejected) {
      // Restore previous status. If we somehow didn't capture one (shouldn't
      // happen — it's set on every request), fall back to 'assigned'.
      const restoreTo = request.previousStatus ?? 'assigned';
      await db.task.update({ where: { id: task.id }, data: { status: restoreTo } });
    } else {
      throw new BadRequestException(`Unknown decision '${dto.decision}'`);
    }

    const decided = await db.taskReassignmentRequest.update({
      where: { id: request.id },
      data: {
        status: dto.decision,
        decidedByUserId: tenant.userId,
        decidedAt: new Date(),
        decisionNote: dto.note ?? null,
      },
    });

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'task_reassignment_decided',
      targetType: 'task',
      targetId: task.id,
      metadata: {
        requestId: request.id,
        decision: dto.decision,
        from: 'reassignment_requested',
        to: dto.decision === 'approved' ? 'draft' : (request.previousStatus ?? 'assigned'),
        ...(dto.note ? { note: dto.note } : {}),
      },
    });

    return { task: await this.reloadTask(db, task.id), request: decided };
  }

  private reloadTask(db: Prisma.TransactionClient, id: string) {
    return db.task.findUnique({
      where: { id },
      include: { assignees: { select: { userId: true, assignedAt: true } } },
    });
  }
}
