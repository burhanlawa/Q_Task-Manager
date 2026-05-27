import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export enum CreateTaskPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Urgent = 'urgent',
}

export class CreateTaskDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(CreateTaskPriority)
  priority?: CreateTaskPriority;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  // First entry becomes the primary assignee (tasks.assigned_to_user_id).
  // All entries get a row in task_assignees and the trigger maintains
  // tasks.assignee_count.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Type(() => String)
  assigneeUserIds?: string[];

  // Tags to attach to the new task. Each must exist in this tenant; tag
  // categories are not enforced here (the category-mandate check lands
  // with Sprint 10.5+).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Type(() => String)
  tagIds?: string[];
}
