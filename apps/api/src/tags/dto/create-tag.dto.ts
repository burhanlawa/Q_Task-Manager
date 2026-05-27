import {
  IsHexColor,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CreateTagDto {
  @IsString()
  @IsNotEmpty()
  // Tags are short labels; reject novellas + leading/trailing whitespace at
  // the controller layer where it's easier to give a clean error message.
  @Length(1, 80)
  @Matches(/^\S(?:.*\S)?$/, { message: 'name must not have leading or trailing whitespace' })
  name!: string;

  @IsUUID()
  categoryId!: string;

  // Optional CSS color. Hex-only for now; we'll widen if the UI needs more.
  @IsOptional()
  @IsHexColor()
  color?: string;
}
