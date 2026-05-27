import { Module } from '@nestjs/common';
import { TaskTransitionsController } from './task-transitions.controller';
import { TasksController } from './tasks.controller';

@Module({
  controllers: [TasksController, TaskTransitionsController],
})
export class TasksModule {}
