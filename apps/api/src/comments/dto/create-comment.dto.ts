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

  // File ids the client just uploaded with purpose=comment_attachment and
  // ownerId still null. The server claims each on create by setting
  // owner_type='comment' and owner_id=<new comment id>.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Type(() => String)
  attachment_file_ids?: string[];
}
