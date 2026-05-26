import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ListDepartmentsQuery {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  includeArchived?: boolean;
}
