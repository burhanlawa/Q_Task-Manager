import { Module } from '@nestjs/common';
import { EmployeePerformanceService } from './employee-performance.service';
import { ReportsController } from './reports.controller';
import { TasksCompletionService } from './tasks-completion.service';

@Module({
  controllers: [ReportsController],
  providers: [TasksCompletionService, EmployeePerformanceService],
  exports: [TasksCompletionService, EmployeePerformanceService],
})
export class ReportsModule {}
