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

// Per-audience filter. target_ids is the canonical spec shape (one array
// of UUIDs whose meaning depends on the audience kind). Legacy single-id
// keys from 16.1/16.2 (branch_id, role_id, user_ids) are still accepted
// at the resolver layer so existing broadcast rows resolve cleanly.
class AudienceFilterDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  target_ids?: string[];

  // ---- 16.2 legacy keys, kept for backwards-compat with existing broadcast rows. ----
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

  // 'all_company' kept as a legacy alias for 'company' so the 16.2
  // checks-in-the-wild keep working.
  @IsIn(['company', 'all_company', 'branch', 'department', 'team', 'role', 'custom'])
  audience!: 'company' | 'all_company' | 'branch' | 'department' | 'team' | 'role' | 'custom';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audience_filter?: AudienceFilterDto;
}
