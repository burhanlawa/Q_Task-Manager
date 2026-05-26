import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum DepartmentListStatus {
  Active = 'active',
  Archived = 'archived',
  All = 'all',
}

export class ListDepartmentsQuery {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(DepartmentListStatus)
  status?: DepartmentListStatus;
}
