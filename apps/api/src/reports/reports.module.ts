import { Module } from '@nestjs/common';
import { EmployeePerformanceService } from './employee-performance.service';
import { ReportsController } from './reports.controller';
import { TasksCompletionService } from './tasks-completion.service';
import { WorkloadDistributionService } from './workload-distribution.service';

@Module({
  controllers: [ReportsController],
  providers: [TasksCompletionService, EmployeePerformanceService, WorkloadDistributionService],
  exports: [TasksCompletionService, EmployeePerformanceService, WorkloadDistributionService],
})
export class ReportsModule {}
