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
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CalendarService, type CalendarHoliday } from '../calendar/calendar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQuery } from './dto/list-tasks.query';
import { SetTaskTagsDto } from './dto/set-task-tags.dto';
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
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
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

    // Validate tags up-front (before creating the task row) so we can also
    // enforce the mandatory-category rule from Sprint 10.5. Doing this here
    // means a rejected create leaves no orphan task row behind.
    const tagIds = dto.tagIds ?? [];
    let tagsWithCategory: Array<{ id: string; categoryId: string }> = [];
    if (tagIds.length > 0) {
      tagsWithCategory = await db.tag.findMany({
        where: { id: { in: tagIds }, deletedAt: null },
        select: { id: true, categoryId: true },
      });
      if (tagsWithCategory.length !== tagIds.length) {
        throw new BadRequestException('One or more tags do not exist in this tenant');
      }
    }

    // Mandatory-category enforcement: every category flagged is_mandatory
    // must be represented by at least one of the supplied tags. We pull
    // mandatory categories with one query, then check coverage in memory.
    const mandatoryCategories = await db.tagCategory.findMany({
      where: { isMandatory: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (mandatoryCategories.length > 0) {
      const coveredCategoryIds = new Set(tagsWithCategory.map((t) => t.categoryId));
      const missing = mandatoryCategories.filter((c) => !coveredCategoryIds.has(c.id));
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          message: `Missing required tag from category: ${missing.map((c) => c.name).join(', ')}`,
          missingCategories: missing.map((c) => ({ id: c.id, name: c.name })),
        });
      }
    }

    // Status: 'draft' when no assignees, 'assigned' once we have someone on it.
    // Spec said "pending" but our task_status enum has no 'pending' value;
    // these two cover the intent. Sprint 8.5+ transitions move it forward.
    const status = assigneeIds.length === 0 ? 'draft' : 'assigned';

    // Business-day auto-adjust (Sprint 10.7). We only adjust when a due date
    // was set AND there is at least one assignee. With no assignee there's no
    // "whose calendar?" — keep the requested date as typed.
    //
    // We roll the date forward day-by-day until isWorkingDay() holds for
    // EVERY assignee (and the branch+company). 60-day cap stops a misconfigured
    // tenant (e.g. workingDays=0) from infinite looping; over the cap we
    // accept the original date and skip the adjustment.
    const branchId = dto.branchId ?? dept.branchId;
    let adjustedDueDate: Date | null = dto.dueDate ? new Date(dto.dueDate) : null;
    let originalDueDate: Date | null = null;
    let adjustmentReason: string | null = null;
    if (adjustedDueDate && assigneeIds.length > 0) {
      const [company, branch, assigneeUsers] = await Promise.all([
        db.company.findUnique({
          where: { id: tenant.companyId },
          select: { workingDays: true },
        }),
        branchId
          ? db.branch.findUnique({
              where: { id: branchId },
              select: { id: true, workingDays: true },
            })
          : Promise.resolve(null),
        db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, leaveStartDate: true, leaveEndDate: true },
        }),
      ]);

      if (company && branch) {
        // Pull holidays for company-wide AND this branch in a wide window
        // around the target date once — cheaper than per-day queries.
        const windowStart = new Date(adjustedDueDate);
        const windowEnd = new Date(adjustedDueDate);
        windowEnd.setUTCDate(windowEnd.getUTCDate() + 60);
        const holidayRows = await db.holiday.findMany({
          where: {
            companyId: tenant.companyId,
            deletedAt: null,
            date: { gte: windowStart, lte: windowEnd },
            OR: [{ branchId: null }, { branchId: branch.id }],
          },
          select: { date: true, branchId: true },
        });
        const holidays: CalendarHoliday[] = holidayRows;

        const requested = new Date(adjustedDueDate);
        let probe = new Date(adjustedDueDate);
        let movedDays = 0;
        const blockedBy: string[] = [];

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const allCanWork = assigneeUsers.every((u) =>
            this.calendar.isWorkingDay({
              company,
              branch,
              user: u,
              holidays,
              date: probe,
            }),
          );
          if (allCanWork) break;
          if (movedDays === 0) {
            // First failure — record why we're moving so the activity log
            // entry can be human-readable.
            const dow = probe.getUTCDay();
            const bitmask = branch.workingDays ?? company.workingDays;
            const isWeekend = (bitmask & (1 << dow)) === 0;
            const isHoliday = holidays.some(
              (h) =>
                h.date.toISOString().slice(0, 10) === probe.toISOString().slice(0, 10) &&
                (h.branchId === null || h.branchId === branch.id),
            );
            if (isWeekend) blockedBy.push('weekend');
            if (isHoliday) blockedBy.push('holiday');
            const onLeave = assigneeUsers.filter(
              (u) =>
                u.leaveStartDate &&
                u.leaveEndDate &&
                probe.toISOString().slice(0, 10) >= u.leaveStartDate.toISOString().slice(0, 10) &&
                probe.toISOString().slice(0, 10) <= u.leaveEndDate.toISOString().slice(0, 10),
            );
            if (onLeave.length > 0) blockedBy.push('assignee_on_leave');
          }
          probe.setUTCDate(probe.getUTCDate() + 1);
          movedDays += 1;
          if (movedDays > 60) {
            // Misconfigured tenant — abandon the adjustment and keep the
            // requested date. We log nothing; the date stays as typed.
            probe = requested;
            movedDays = 0;
            break;
          }
        }

        if (movedDays > 0) {
          originalDueDate = requested;
          adjustedDueDate = probe;
          adjustmentReason = blockedBy.join('+') || 'non_working_day';
        }
      }
    }

    const task = await db.task.create({
      data: {
        companyId: tenant.companyId,
        departmentId: dto.departmentId,
        teamId: dto.teamId ?? null,
        branchId: branchId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'medium',
        dueDate: adjustedDueDate,
        originalDueDate: originalDueDate,
        dueDateAdjustmentReason: adjustmentReason,
        status,
        createdByUserId: tenant.userId,
        assignedToUserId: assigneeIds[0] ?? null,
      },
    });

    if (adjustmentReason && originalDueDate && adjustedDueDate) {
      await this.activity.record({
        db,
        companyId: tenant.companyId,
        actorUserId: tenant.userId,
        actionType: 'task_due_date_adjusted',
        targetType: 'task',
        targetId: task.id,
        metadata: {
          from: originalDueDate.toISOString().slice(0, 10),
          to: adjustedDueDate.toISOString().slice(0, 10),
          reason: adjustmentReason,
        },
      });
    }

    if (assigneeIds.length > 0) {
      await db.taskAssignee.createMany({
        data: assigneeIds.map((userId) => ({
          taskId: task.id,
          userId,
          assignedByUserId: tenant.userId,
        })),
      });
      // The DB trigger from 8.2 maintains tasks.assignee_count automatically.

      // Sprint 14.3 — notify each newly-assigned user. Self-assignment doesn't
      // notify (you don't need a notification for something you just did).
      // Runs inside the same tx as the row insert + the task create, so a
      // partial failure rolls everything back together.
      for (const userId of assigneeIds) {
        if (userId === tenant.userId) continue;
        await this.notifications.create(db, {
          recipientId: userId,
          companyId: tenant.companyId,
          type: 'task_assigned',
          title: task.title,
          message: `You were assigned to a task.`,
          relatedEntityType: 'task',
          relatedEntityId: task.id,
          actionUrl: `/tasks/${task.id}`,
          actorUserId: tenant.userId,
        });
      }
    }

    // Attach tags. The set was already validated above (existence +
    // mandatory-category coverage). The DB trigger from 10.2 maintains
    // tags.usage_count automatically.
    if (tagIds.length > 0) {
      await db.taskTag.createMany({
        data: tagIds.map((tagId) => ({
          taskId: task.id,
          tagId,
          addedByUserId: tenant.userId,
        })),
      });
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
        tagCount: tagIds.length,
      },
    });

    return db.task.findUnique({
      where: { id: task.id },
      include: {
        assignees: { select: { userId: true, assignedAt: true } },
        taskTags: {
          select: {
            tagId: true,
            tag: { select: { id: true, name: true, color: true, categoryId: true } },
          },
        },
      },
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
      include: {
        assignees: { select: { userId: true, assignedAt: true } },
        taskTags: {
          select: {
            tagId: true,
            tag: { select: { id: true, name: true, color: true, categoryId: true } },
          },
        },
      },
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

  // PUT /tasks/:id/tags — replace the full tag set on a task. This is the
  // only mutation on task_tags from the app (POST /tasks attaches the
  // initial set; the trigger maintains usage_count both ways). Like PATCH,
  // we lock this to the editable statuses — once work has begun, the tag
  // set is part of the work record.
  @Put(':id/tags')
  @RequirePermissions('task.update')
  async setTags(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetTaskTagsDto,
  ) {
    const existing = await db.task.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Task not found');
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new ConflictException(
        `Task is in status '${existing.status}'; tag edits are only allowed in 'draft' or 'assigned'`,
      );
    }

    // Validate that every tag exists in this tenant before any mutation.
    if (dto.tagIds.length > 0) {
      const tags = await db.tag.findMany({
        where: { id: { in: dto.tagIds }, deletedAt: null },
        select: { id: true },
      });
      if (tags.length !== dto.tagIds.length) {
        throw new BadRequestException('One or more tags do not exist in this tenant');
      }
    }

    // Diff against current rows so usage_count moves correctly (the trigger
    // fires per row inserted/deleted; leaving unchanged rows alone keeps
    // counts stable).
    const current = await db.taskTag.findMany({
      where: { taskId: id },
      select: { tagId: true },
    });
    const currentSet = new Set(current.map((r) => r.tagId));
    const targetSet = new Set(dto.tagIds);

    const toAdd = dto.tagIds.filter((t) => !currentSet.has(t));
    const toRemove = current.map((r) => r.tagId).filter((t) => !targetSet.has(t));

    if (toRemove.length > 0) {
      await db.taskTag.deleteMany({
        where: { taskId: id, tagId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await db.taskTag.createMany({
        data: toAdd.map((tagId) => ({ taskId: id, tagId })),
      });
    }

    return db.task.findUnique({
      where: { id },
      include: {
        assignees: { select: { userId: true, assignedAt: true } },
        taskTags: {
          select: {
            tagId: true,
            tag: { select: { id: true, name: true, color: true, categoryId: true } },
          },
        },
      },
    });
  }
}
