import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import {
  TasksCompletionService,
  type RangePreset,
  type TasksCompletionResult,
} from './tasks-completion.service';

class TasksCompletionQuery {
  @IsIn(['7d', '30d', '90d'])
  range!: RangePreset;

  @IsOptional()
  @IsUUID('4')
  department_id?: string;

  @IsOptional()
  @IsUUID('4')
  assignee_user_id?: string;
}

@Controller('reports')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class ReportsController {
  constructor(private readonly tasksCompletionSvc: TasksCompletionService) {}

  // GET /reports/tasks-completion?range=7d&department_id=&assignee_user_id=
  //
  // Returns { range, from, to, buckets: [{date, completed, total}] } with one
  // bucket per day in the range. Result cached for 5 minutes per
  // (company, range, filter) tuple. Permission gate: report.read.
  @Get('tasks-completion')
  @RequirePermissions('report.read')
  async tasksCompletion(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: TasksCompletionQuery,
  ): Promise<TasksCompletionResult> {
    return this.tasksCompletionSvc.compute(db, {
      companyId: tenant.companyId,
      range: q.range,
      departmentId: q.department_id ?? null,
      assigneeUserId: q.assignee_user_id ?? null,
    });
  }
}
