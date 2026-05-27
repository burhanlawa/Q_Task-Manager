import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
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
import { CreateTaskDto } from './dto/create-task.dto';

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
}
