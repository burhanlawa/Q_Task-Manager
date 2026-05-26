import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  // Allow explicit null to clear the supervisor.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  supervisorId?: string | null;
}
