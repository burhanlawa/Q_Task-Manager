import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum UserListStatus {
  Active = 'active',
  Invited = 'invited',
  Suspended = 'suspended',
  Deactivated = 'deactivated',
  All = 'all',
}

export class ListUsersQuery {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsEnum(UserListStatus)
  status?: UserListStatus;
}
