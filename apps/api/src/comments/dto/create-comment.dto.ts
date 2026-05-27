import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateCommentDto {
  // Rich-text HTML from TipTap. Length cap is generous; the DB CHECK kills
  // empty/whitespace-only bodies regardless of what the user types.
  @IsString()
  @IsNotEmpty()
  @Length(1, 50_000)
  body!: string;

  // Optional list of mentioned user ids (the TipTap mention extension can
  // also encode them in the body HTML, but a structured list lets the server
  // skip HTML parsing). Capped at 50 — generous for any sensible workflow.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Type(() => String)
  mentioned_user_ids?: string[];
}
