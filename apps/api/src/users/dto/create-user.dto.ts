import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export enum CreateUserOrgRole {
  Manager = 'manager',
  Supervisor = 'supervisor',
  Employee = 'employee',
  HR = 'hr',
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string;

  @IsOptional()
  @IsEnum(CreateUserOrgRole)
  orgRole?: CreateUserOrgRole;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
