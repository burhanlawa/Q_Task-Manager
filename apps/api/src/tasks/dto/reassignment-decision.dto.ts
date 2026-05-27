import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export enum ReassignmentDecision {
  approved = 'approved',
  rejected = 'rejected',
}

// POST /tasks/:id/reassignment-decision — body.
export class ReassignmentDecisionDto {
  @IsEnum(ReassignmentDecision)
  decision!: ReassignmentDecision;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
