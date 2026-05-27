import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export enum UploadIntentPurpose {
  task_attachment = 'task_attachment',
  task_submission = 'task_submission',
  avatar = 'avatar',
  company_logo = 'company_logo',
}

export enum UploadIntentAttachedToType {
  task = 'task',
  user = 'user',
  company = 'company',
}

// 50 MB cap per the spec.
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export class UploadIntentDto {
  // Original filename as the user picked it. We sanitize before using; the
  // r2_key is generated server-side, never derived from this verbatim.
  @IsString()
  @Length(1, 255)
  @Matches(/^[^\\/]+$/, { message: 'filename must not contain slashes' })
  filename!: string;

  // MIME type the browser will send on PUT. Server pins this into the
  // pre-signed URL so the client can't switch it mid-upload.
  @IsString()
  @Length(1, 200)
  mime_type!: string;

  @IsInt()
  @Min(1)
  @Max(UPLOAD_MAX_BYTES)
  size_bytes!: number;

  @IsEnum(UploadIntentPurpose)
  purpose!: UploadIntentPurpose;

  // What this file belongs to. NULL is rejected — orphan uploads must come
  // from a different flow if/when we ever need them.
  @IsEnum(UploadIntentAttachedToType)
  attached_to_type!: UploadIntentAttachedToType;

  @IsOptional()
  @IsUUID()
  attached_to_id?: string;

  // When set, this upload is a new version of an existing file. The server
  // resolves the prior row, validates it shares purpose + owner, then sets
  // the new row's version_number = previous.version_number + 1.
  @IsOptional()
  @IsUUID()
  previous_version_id?: string;
}
