import { IsOptional, IsString, Length } from 'class-validator';

export class RejectApprovalDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}
