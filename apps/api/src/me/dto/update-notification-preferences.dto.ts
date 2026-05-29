import { IsObject, IsOptional } from 'class-validator';

// We can't use class-validator's nested decorators here because the outer
// `types` map has arbitrary string keys (the notification-type tokens are
// open-ended and live in apps/api/src/emails/templates/types.ts). With
// forbidNonWhitelisted=true the global ValidationPipe would reject every
// inner key as "should not exist".
//
// Instead we accept any object and let the controller validate the shape
// at runtime (booleans for in_app/email, ignore anything else). Keys are
// inherently safe because they're stored in a JSONB column, not interpolated
// into SQL.
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsObject()
  types?: Record<string, { in_app?: boolean; email?: boolean }>;
}
