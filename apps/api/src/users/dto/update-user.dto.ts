import { IsEnum, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export enum UpdateUserOrgRole {
  CEO = 'ceo',
  Manager = 'manager',
  Supervisor = 'supervisor',
  Employee = 'employee',
  HR = 'hr',
  Admin = 'admin',
}

export enum UpdateUserStatus {
  Active = 'active',
  Suspended = 'suspended',
  Deactivated = 'deactivated',
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @Length(5, 32)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 5)
  locale?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string | null;

  @IsOptional()
  @IsEnum(UpdateUserOrgRole)
  orgRole?: UpdateUserOrgRole;

  @IsOptional()
  @IsEnum(UpdateUserStatus)
  status?: UpdateUserStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  departmentId?: string | null;
}
