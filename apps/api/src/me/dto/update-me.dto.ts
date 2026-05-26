import { IsDateString, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

// Strict whitelist for self-edit. Organizational fields (orgRole, status,
// branchId, departmentId, employmentStatus, nationalId) are NOT here — those
// require admin action via PATCH /users/:id.
//
// `null` clears the field where the column is nullable. `undefined` (key
// omitted entirely) means "no change."
export class UpdateMeDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(1, 80)
  firstName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(1, 80)
  lastName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(1, 120)
  displayName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(5, 32)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 5)
  locale?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(1, 64)
  timezone?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dateOfBirth?: string | null;
}
