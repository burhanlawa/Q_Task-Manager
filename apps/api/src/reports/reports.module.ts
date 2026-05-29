import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { TasksCompletionService } from './tasks-completion.service';

@Module({
  controllers: [ReportsController],
  providers: [TasksCompletionService],
  exports: [TasksCompletionService],
})
export class ReportsModule {}
