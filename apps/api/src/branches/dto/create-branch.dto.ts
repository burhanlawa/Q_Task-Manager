import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166 alpha-2 code (uppercase)' })
  country?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}
