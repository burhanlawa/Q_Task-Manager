import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  // Allow explicit null to move a department back to root.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentDepartmentId?: string | null;
}
