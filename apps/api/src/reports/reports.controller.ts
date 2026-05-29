import { Controller, Get, Header, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import {
  EmployeePerformanceService,
  type EmployeePerformanceRange,
  type EmployeePerformanceResult,
} from './employee-performance.service';
import {
  TasksCompletionService,
  type RangePreset,
  type TasksCompletionResult,
} from './tasks-completion.service';
import {
  WorkloadDistributionService,
  type WorkloadDistributionResult,
} from './workload-distribution.service';

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

class EmployeePerformanceQuery {
  @IsIn(['7d', '30d', '90d'])
  range!: EmployeePerformanceRange;

  @IsOptional()
  @IsUUID('4')
  department_id?: string;
}

class WorkloadDistributionQuery {
  // No range — workload is "right now," not a windowed metric.
  @IsOptional()
  @IsUUID('4')
  department_id?: string;
}

@Controller('reports')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class ReportsController {
  constructor(
    private readonly tasksCompletionSvc: TasksCompletionService,
    private readonly employeePerformanceSvc: EmployeePerformanceService,
    private readonly workloadDistributionSvc: WorkloadDistributionService,
  ) {}

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

  // GET /reports/employee-performance?range=30d&department_id=
  //
  // Returns { range, from, to, rows: [{userId, displayName, email,
  // assigned, completed, onTimePct, avgRevisions}] }, one row per user
  // who had at least one assigned task in the range. Ordered by
  // assigned-count desc. Result cached for 5 minutes per
  // (company, range, dept) tuple. Permission gate: report.read.
  @Get('employee-performance')
  @RequirePermissions('report.read')
  async employeePerformance(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: EmployeePerformanceQuery,
  ): Promise<EmployeePerformanceResult> {
    return this.employeePerformanceSvc.compute(db, {
      companyId: tenant.companyId,
      range: q.range,
      departmentId: q.department_id ?? null,
    });
  }

  // GET /reports/workload-distribution?department_id=
  //
  // Returns { rows: [{userId, displayName, email, openCount, byPriority,
  // weightedLoad}] } sorted by weightedLoad desc (then openCount, then
  // name). One row per user with at least one OPEN assignment (open =
  // any non-terminal status). Result cached for 5 minutes per
  // (company, dept) tuple. Permission gate: report.read.
  @Get('workload-distribution')
  @RequirePermissions('report.read')
  async workloadDistribution(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: WorkloadDistributionQuery,
  ): Promise<WorkloadDistributionResult> {
    return this.workloadDistributionSvc.compute(db, {
      companyId: tenant.companyId,
      departmentId: q.department_id ?? null,
    });
  }

  // ---- CSV exports (Sprint 18.4) -------------------------------------
  //
  // Same filter shape as the JSON endpoints above; the export reuses the
  // cached service result, so a Web client that just rendered the chart
  // hits Redis again here instead of re-running the SQL. CSV writing
  // uses the streaming pattern from Sprint 17.6: BOM + header + rows
  // via res.write so we don't load the whole array twice.
  //
  // Cells are RFC 4180-quoted via csvCell; always-quote keeps parsing
  // predictable and the size overhead is noise.

  @Get('tasks-completion/export')
  @RequirePermissions('report.read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="tasks-completion.csv"')
  @Header('cache-control', 'no-store')
  async exportTasksCompletion(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: TasksCompletionQuery,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.tasksCompletionSvc.compute(db, {
      companyId: tenant.companyId,
      range: q.range,
      departmentId: q.department_id ?? null,
      assigneeUserId: q.assignee_user_id ?? null,
    });
    res.write('﻿');
    res.write(['date', 'total', 'completed'].map(csvCell).join(',') + '\n');
    for (const b of data.buckets) {
      res.write([b.date, b.total, b.completed].map(csvCell).join(',') + '\n');
    }
    res.end();
  }

  @Get('employee-performance/export')
  @RequirePermissions('report.read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="employee-performance.csv"')
  @Header('cache-control', 'no-store')
  async exportEmployeePerformance(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: EmployeePerformanceQuery,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.employeePerformanceSvc.compute(db, {
      companyId: tenant.companyId,
      range: q.range,
      departmentId: q.department_id ?? null,
    });
    res.write('﻿');
    res.write(
      ['user_id', 'name', 'email', 'assigned', 'completed', 'on_time_pct', 'avg_revisions']
        .map(csvCell)
        .join(',') + '\n',
    );
    for (const r of data.rows) {
      res.write(
        [
          r.userId,
          r.displayName ?? '',
          r.email,
          r.assigned,
          r.completed,
          r.onTimePct ?? '',
          r.avgRevisions,
        ]
          .map(csvCell)
          .join(',') + '\n',
      );
    }
    res.end();
  }

  @Get('workload-distribution/export')
  @RequirePermissions('report.read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="workload-distribution.csv"')
  @Header('cache-control', 'no-store')
  async exportWorkloadDistribution(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: WorkloadDistributionQuery,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.workloadDistributionSvc.compute(db, {
      companyId: tenant.companyId,
      departmentId: q.department_id ?? null,
    });
    res.write('﻿');
    res.write(
      ['user_id', 'name', 'email', 'open_count', 'weighted_load', 'low', 'medium', 'high', 'urgent']
        .map(csvCell)
        .join(',') + '\n',
    );
    for (const r of data.rows) {
      res.write(
        [
          r.userId,
          r.displayName ?? '',
          r.email,
          r.openCount,
          r.weightedLoad,
          r.byPriority.low,
          r.byPriority.medium,
          r.byPriority.high,
          r.byPriority.urgent,
        ]
          .map(csvCell)
          .join(',') + '\n',
      );
    }
    res.end();
  }
}

// RFC 4180-ish CSV escaping: always quote, double internal quotes.
// Matches the helper from activity-log.controller.ts.
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}
