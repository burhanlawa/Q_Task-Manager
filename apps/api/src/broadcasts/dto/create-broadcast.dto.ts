import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

// Per-audience filter. All fields optional at the type level; the resolver
// checks the right one is present for the chosen audience.
class AudienceFilterDto {
  @IsOptional()
  @IsUUID('4')
  branch_id?: string;

  @IsOptional()
  @IsUUID('4')
  role_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  user_ids?: string[];
}

export class CreateBroadcastDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsIn(['all_company', 'branch', 'role', 'custom'])
  audience!: 'all_company' | 'branch' | 'role' | 'custom';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audience_filter?: AudienceFilterDto;
}
