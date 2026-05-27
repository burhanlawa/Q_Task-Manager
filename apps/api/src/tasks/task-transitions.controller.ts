import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
import { TransitionTaskDto } from './dto/transition-task.dto';

type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'reassignment_requested'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

// Sprint 8.6 — state transition endpoints. The lifecycle (blueprint §4.6):
//
//   draft → assigned       (POST /tasks with assignees, handled by 8.4)
//   assigned → in_progress (POST :id/accept | :id/start)
//   in_progress → submitted (POST :id/submit)
//   submitted → completed   (POST :id/approve)
//   submitted → in_progress (POST :id/request-revision)
//   any non-terminal → cancelled (POST :id/cancel)
//
// Caller gates:
//   accept/start/submit   → must be an assignee (task_assignees row OR the
//                            legacy single-assignee column)
//   approve/request-rev   → task creator OR holds `task.approve`
//   cancel                → task creator OR holds `task.cancel`
//
// Every transition writes an activity_log entry with before/after status and
// (when provided) the caller's note.

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'cancelled']);

@Controller('tasks')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class TaskTransitionsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Post(':id/accept')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async accept(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    return this.startOrAccept(db, tenant, id, dto, 'accepted');
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async start(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    return this.startOrAccept(db, tenant, id, dto, 'started');
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async submit(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    const task = await this.loadOrThrow(db, id);
    await this.requireAssignee(db, task.id, tenant.userId);
    this.requireStatus(task.status, 'in_progress', 'submit');
    return this.transition(db, tenant, task, 'submitted', 'task_submitted', dto.note);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async approve(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    const task = await this.loadOrThrow(db, id);
    await this.requireCreatorOrPermission(tenant, task.createdByUserId, 'task.approve');
    this.requireStatus(task.status, 'submitted', 'approve');
    return this.transition(db, tenant, task, 'completed', 'task_approved', dto.note);
  }

  @Post(':id/request-revision')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async requestRevision(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    const task = await this.loadOrThrow(db, id);
    await this.requireCreatorOrPermission(tenant, task.createdByUserId, 'task.approve');
    this.requireStatus(task.status, 'submitted', 'request-revision');
    return this.transition(db, tenant, task, 'in_progress', 'task_revision_requested', dto.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('task.read')
  async cancel(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionTaskDto,
  ) {
    const task = await this.loadOrThrow(db, id);
    await this.requireCreatorOrPermission(tenant, task.createdByUserId, 'task.cancel');
    if (TERMINAL.has(task.status)) {
      throw new ConflictException(`Cannot cancel a task in terminal status '${task.status}'`);
    }
    return this.transition(db, tenant, task, 'cancelled', 'task_cancelled', dto.note);
  }

  // ---------- helpers ----------

  private async startOrAccept(
    db: Prisma.TransactionClient,
    tenant: TenantContext,
    id: string,
    dto: TransitionTaskDto,
    verbForLog: 'accepted' | 'started',
  ) {
    const task = await this.loadOrThrow(db, id);
    await this.requireAssignee(db, task.id, tenant.userId);
    this.requireStatus(task.status, 'assigned', verbForLog === 'accepted' ? 'accept' : 'start');
    return this.transition(
      db,
      tenant,
      task,
      'in_progress',
      verbForLog === 'accepted' ? 'task_accepted' : 'task_started',
      dto.note,
    );
  }

  private async loadOrThrow(db: Prisma.TransactionClient, id: string) {
    const task = await db.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        createdByUserId: true,
        assignedToUserId: true,
      },
    });
    if (!task || task.deletedAt) throw new NotFoundException('Task not found');
    return task;
  }

  private requireStatus(actual: TaskStatus, expected: TaskStatus, action: string) {
    if (actual !== expected) {
      throw new ConflictException(
        `Cannot ${action} a task in status '${actual}'; expected '${expected}'`,
      );
    }
  }

  private async requireAssignee(db: Prisma.TransactionClient, taskId: string, userId: string) {
    const row = await db.taskAssignee.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { taskId: true },
    });
    if (row) return;
    // Fall back to the legacy single-assignee column for tasks that pre-date
    // the multi-assignee join (or were created with exactly one assignee).
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { assignedToUserId: true },
    });
    if (task?.assignedToUserId === userId) return;
    throw new ForbiddenException('Only an assignee of this task can perform this action');
  }

  private async requireCreatorOrPermission(
    tenant: TenantContext,
    createdByUserId: string,
    permKey: string,
  ) {
    if (tenant.userId === createdByUserId) return;
    const granted = await this.permissions.getEffectivePermissions(tenant.userId);
    if (this.permissions.has(granted, permKey)) return;
    throw new ForbiddenException(
      `Only the task creator or a user with '${permKey}' can perform this action`,
    );
  }

  private async transition(
    db: Prisma.TransactionClient,
    tenant: TenantContext,
    task: { id: string; status: TaskStatus },
    to: TaskStatus,
    actionType: string,
    note: string | undefined,
  ) {
    const from = task.status;
    const updated = await db.task.update({
      where: { id: task.id },
      data: { status: to },
      include: { assignees: { select: { userId: true, assignedAt: true } } },
    });

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType,
      targetType: 'task',
      targetId: task.id,
      metadata: {
        from,
        to,
        ...(note ? { note } : {}),
      },
    });

    return updated;
  }
}
