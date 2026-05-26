import { ArrayUnique, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class UpdateRoleDto {
  // Non-builtin roles can be renamed; builtin roles ignore this field (the
  // controller silently strips it for builtins so the UI doesn't need branchy
  // request bodies).
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  // Replace the entire permissions list. Empty array is valid (revokes
  // everything from this role).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
