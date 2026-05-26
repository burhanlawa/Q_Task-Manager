import { IsEnum, IsOptional } from 'class-validator';

export enum BranchListStatus {
  Active = 'active',
  Archived = 'archived',
  All = 'all',
}

export class ListBranchesQuery {
  @IsOptional()
  @IsEnum(BranchListStatus)
  status?: BranchListStatus;
}
