import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { TaskReassignmentController } from './task-reassignment.controller';
import { TaskTransitionsController } from './task-transitions.controller';
import { TasksController } from './tasks.controller';

@Module({
  imports: [CalendarModule],
  controllers: [TasksController, TaskTransitionsController, TaskReassignmentController],
})
export class TasksModule {}
