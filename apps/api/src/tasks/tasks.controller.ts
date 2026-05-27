import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQuery } from './dto/list-tasks.query';
import { UpdateTaskDto } from './dto/update-task.dto';

// Statuses where content metadata is still editable. Anything past these
// requires the state-machine endpoint (Sprint 8.6+) to transition first.
const EDITABLE_STATUSES = new Set(['draft', 'assigned']);

@Controller('tasks')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class TasksController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Post()
  @RequirePermissions('task.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTaskDto,
  ) {
    // Verify the target department exists in this tenant. RLS scopes the
    // lookup; a miss is either cross-tenant (RLS hides it) or doesn't exist.
    const dept = await db.department.findUnique({
      where: { id: dto.departmentId },
      select: { id: true, branchId: true, deletedAt: true },
    });
    if (!dept || dept.deletedAt) throw new NotFoundException('Department not found');

    // Verify team if provided. team must belong to the same department.
    if (dto.teamId) {
      const team = await db.team.findUnique({
        where: { id: dto.teamId },
        select: { departmentId: true, deletedAt: true },
      });
      if (!team || team.deletedAt) throw new NotFoundException('Team not found');
      if (team.departmentId !== dto.departmentId) {
        throw new BadRequestException('Team belongs to a different department');
      }
    }

    // Validate assignees if any, AND enforce the cross-department rule.
    const assigneeIds = dto.assigneeUserIds ?? [];
    if (assigneeIds.length > 0) {
      const assignees = await db.user.findMany({
        where: { id: { in: assigneeIds }, deletedAt: null },
        select: { id: true, departmentId: true },
      });
      if (assignees.length !== assigneeIds.length) {
        // Some assignee ids were missing/archived/cross-tenant (RLS-hidden).
        throw new BadRequestException('One or more assignees do not exist in this tenant');
      }

      const crossDept = assignees.some((a) => a.departmentId !== dto.departmentId);
      if (crossDept) {
        const granted = await this.permissions.getEffectivePermissions(tenant.userId);
        if (!this.permissions.has(granted, 'task.assign_cross_department')) {
          throw new ForbiddenException(
            'Missing permission: task.assign_cross_department (one or more assignees are in a different department)',
          );
        }
      }
    }

    // Status: 'draft' when no assignees, 'assigned' once we have someone on it.
    // Spec said "pending" but our task_status enum has no 'pending' value;
    // these two cover the intent. Sprint 8.5+ transitions move it forward.
    const status = assigneeIds.length === 0 ? 'draft' : 'assigned';

    const task = await db.task.create({
      data: {
        companyId: tenant.companyId,
        departmentId: dto.departmentId,
        teamId: dto.teamId ?? null,
        branchId: dto.branchId ?? dept.branchId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'medium',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status,
        createdByUserId: tenant.userId,
        assignedToUserId: assigneeIds[0] ?? null,
      },
    });

    if (assigneeIds.length > 0) {
      await db.taskAssignee.createMany({
        data: assigneeIds.map((userId) => ({
          taskId: task.id,
          userId,
          assignedByUserId: tenant.userId,
        })),
      });
      // The DB trigger from 8.2 maintains tasks.assignee_count automatically.
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'task_created',
      targetType: 'task',
      targetId: task.id,
      metadata: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        departmentId: task.departmentId,
        assigneeCount: assigneeIds.length,
      },
    });

    return db.task.findUnique({
      where: { id: task.id },
      include: { assignees: { select: { userId: true, assignedAt: true } } },
    });
  }

  @Get()
  @RequirePermissions('task.read')
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListTasksQuery) {
    // Cursor pagination: fetch limit+1 rows; if we get the extra, peel it off
    // and return its id as the next cursor. Ordering must be deterministic, so
    // we tie-break on id when createdAt collides.
    const limit = q.limit ?? 25;
    const rows = await db.task.findMany({
      where: {
        ...(q.includeArchived ? {} : { deletedAt: null }),
        ...(q.status && q.status.length > 0 ? { status: { in: q.status } } : {}),
        ...(q.assigneeUserId
          ? {
              OR: [
                { assignedToUserId: q.assigneeUserId },
                { assignees: { some: { userId: q.assigneeUserId } } },
              ],
            }
          : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.teamId ? { teamId: q.teamId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id ?? null;
    }
    return { items, nextCursor };
  }

  @Get(':id')
  @RequirePermissions('task.read')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const task = await db.task.findUnique({
      where: { id },
      include: { assignees: { select: { userId: true, assignedAt: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // Activity log for a task, newest first. The actor is inlined so the UI
  // doesn't need a follow-up users call to render "X did Y". RLS scopes the
  // log to the caller's tenant; a wrong tenant gets an empty list.
  @Get(':id/activity')
  @RequirePermissions('task.read')
  async getActivity(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // Confirm the task exists / is visible before listing — otherwise a 404
    // task would silently return [] which is confusing.
    const task = await db.task.findUnique({ where: { id }, select: { id: true } });
    if (!task) throw new NotFoundException('Task not found');

    const rows = await db.activityLog.findMany({
      where: { targetType: 'task', targetId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        actionType: true,
        metadata: true,
        createdAt: true,
        actorUserId: true,
      },
    });

    const actorIds = Array.from(
      new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x)),
    );
    const actors = actorIds.length
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, u]));

    return {
      items: rows.map((r) => ({
        ...r,
        actor: r.actorUserId ? (actorById.get(r.actorUserId) ?? null) : null,
      })),
    };
  }

  @Patch(':id')
  @RequirePermissions('task.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const existing = await db.task.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true, departmentId: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Task not found');

    // Sprint 8.5 done check: editing after the task is in_progress (or beyond)
    // is rejected. PATCH is for content metadata while the task is still in
    // the planning stage; once work starts, the state machine owns the row.
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new ConflictException(
        `Task is in status '${existing.status}'; edits via PATCH are only allowed in 'draft' or 'assigned'`,
      );
    }

    // If reassigning to a different department, verify it exists in this tenant.
    if (dto.departmentId && dto.departmentId !== existing.departmentId) {
      const dept = await db.department.findUnique({
        where: { id: dto.departmentId },
        select: { id: true, deletedAt: true },
      });
      if (!dept || dept.deletedAt) throw new NotFoundException('Department not found');
    }
    if (dto.teamId) {
      const team = await db.team.findUnique({
        where: { id: dto.teamId },
        select: { departmentId: true, deletedAt: true },
      });
      if (!team || team.deletedAt) throw new NotFoundException('Team not found');
      const targetDept = dto.departmentId ?? existing.departmentId;
      if (team.departmentId !== targetDept) {
        throw new BadRequestException('Team belongs to a different department');
      }
    }

    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate === null ? null : new Date(dto.dueDate);
    }
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.teamId !== undefined) data.teamId = dto.teamId;
    if (dto.branchId !== undefined) data.branchId = dto.branchId;

    return db.task.update({
      where: { id },
      data,
      include: { assignees: { select: { userId: true, assignedAt: true } } },
    });
  }
}
