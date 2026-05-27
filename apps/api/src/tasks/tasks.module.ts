import { Module } from '@nestjs/common';
import { TaskReassignmentController } from './task-reassignment.controller';
import { TaskTransitionsController } from './task-transitions.controller';
import { TasksController } from './tasks.controller';

@Module({
  controllers: [TasksController, TaskTransitionsController, TaskReassignmentController],
})
export class TasksModule {}
