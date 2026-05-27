import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const ALL_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'submitted',
  'reassignment_requested',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;
type TaskStatus = (typeof ALL_STATUSES)[number];

export class ListTasksQuery {
  // CSV of statuses. Empty → "any non-archived." We use CSV instead of
  // repeated query params so the URL stays compact for the common case
  // (?status=draft,assigned).
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  })
  @IsIn(ALL_STATUSES, { each: true })
  status?: TaskStatus[];

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  includeArchived?: boolean;

  // Cursor pagination. `cursor` is the task id from the previous page's
  // nextCursor; `limit` defaults to 25, capped at 100 to bound response size.
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
