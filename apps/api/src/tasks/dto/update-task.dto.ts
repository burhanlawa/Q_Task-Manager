import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { CreateTaskPriority } from './create-task.dto';

// PATCH /tasks/:id — content metadata only. Status transitions go through a
// dedicated state-machine endpoint (Sprint 8.6+); assignee changes through
// a separate assign endpoint. Editing is rejected with 409 if the task is
// past 'assigned' (Sprint 8.5 done check).
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 5000)
  description?: string | null;

  @IsOptional()
  @IsEnum(CreateTaskPriority)
  priority?: CreateTaskPriority;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  teamId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId?: string | null;
}
