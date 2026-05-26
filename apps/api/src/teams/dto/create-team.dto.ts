import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateTeamDto {
  @IsUUID()
  departmentId!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsUUID()
  supervisorId?: string;
}
