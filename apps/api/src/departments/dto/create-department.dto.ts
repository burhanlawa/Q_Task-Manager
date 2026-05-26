import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateDepartmentDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string;
}
