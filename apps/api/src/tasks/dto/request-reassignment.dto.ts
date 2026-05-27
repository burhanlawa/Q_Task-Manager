import { IsNotEmpty, IsString, Length } from 'class-validator';

// POST /tasks/:id/request-reassignment — body. Reason is required:
// without it, an approver has nothing to evaluate.
export class RequestReassignmentDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 2000)
  reason!: string;
}
