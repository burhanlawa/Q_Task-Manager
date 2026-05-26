import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AddUserTeamDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
