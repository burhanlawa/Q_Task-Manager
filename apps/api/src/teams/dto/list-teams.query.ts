import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum TeamListStatus {
  Active = 'active',
  Archived = 'archived',
  All = 'all',
}

export class ListTeamsQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(TeamListStatus)
  status?: TeamListStatus;
}
