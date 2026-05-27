import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { R2Service } from '../r2/r2.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import {
  UPLOAD_MAX_BYTES,
  UploadIntentAttachedToType,
  UploadIntentDto,
  UploadIntentPurpose,
} from './dto/upload-intent.dto';

// Mime allowlists by purpose. Avatars/logos are visual — JPG/PNG only.
// Task attachments + submissions are working files — common office formats
// + the same two image types.
const IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);
const OFFICE_DOC_MIMES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const TASK_MIMES: ReadonlySet<string> = new Set([...IMAGE_MIMES, ...OFFICE_DOC_MIMES]);

// Which attached_to_type makes sense for each purpose. Mismatched pairings
// (e.g., avatar attached to a task) are rejected up front rather than
// landing as bad orphan rows.
const PURPOSE_RULES: Record<
  UploadIntentPurpose,
  { mimes: ReadonlySet<string>; expectedAttachedTo: UploadIntentAttachedToType }
> = {
  [UploadIntentPurpose.task_attachment]: {
    mimes: TASK_MIMES,
    expectedAttachedTo: UploadIntentAttachedToType.task,
  },
  [UploadIntentPurpose.task_submission]: {
    mimes: TASK_MIMES,
    expectedAttachedTo: UploadIntentAttachedToType.task,
  },
  [UploadIntentPurpose.avatar]: {
    mimes: IMAGE_MIMES,
    expectedAttachedTo: UploadIntentAttachedToType.user,
  },
  [UploadIntentPurpose.company_logo]: {
    mimes: IMAGE_MIMES,
    expectedAttachedTo: UploadIntentAttachedToType.company,
  },
};

@Controller('files')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class FilesController {
  constructor(private readonly r2: R2Service) {}

  // POST /files/upload-intent
  //   Body: filename, mime_type, size_bytes, purpose, attached_to_type, attached_to_id
  //   Returns: { file_id, upload_url, upload_headers, expires_in_seconds, r2_key }
  //
  // Side effect: inserts a files row with upload_status='pending_upload'.
  // The client PUTs to upload_url with the returned headers, then calls
  // /files/:id/confirm (Sprint 11.4) to flip the row to 'uploaded'.
  @Post('upload-intent')
  @RequirePermissions('file.upload')
  async uploadIntent(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UploadIntentDto,
  ) {
    const rule = PURPOSE_RULES[dto.purpose];

    // 1. Mime type allowlisted for this purpose.
    if (!rule.mimes.has(dto.mime_type)) {
      throw new BadRequestException(
        `mime_type '${dto.mime_type}' not allowed for purpose '${dto.purpose}'. ` +
          `Allowed: ${[...rule.mimes].join(', ')}`,
      );
    }

    // 2. attached_to_type must match the purpose. The size check is in the DTO.
    if (dto.attached_to_type !== rule.expectedAttachedTo) {
      throw new BadRequestException(
        `purpose '${dto.purpose}' expects attached_to_type='${rule.expectedAttachedTo}', got '${dto.attached_to_type}'`,
      );
    }

    // 3. attached_to_id must exist in this tenant (and match the type).
    //    For 'company' uploads the only valid id is the caller's company.
    if (dto.attached_to_type === UploadIntentAttachedToType.task) {
      if (!dto.attached_to_id) {
        throw new BadRequestException('attached_to_id is required for task uploads');
      }
      const task = await db.task.findUnique({
        where: { id: dto.attached_to_id },
        select: { id: true, deletedAt: true },
      });
      if (!task || task.deletedAt) throw new NotFoundException('Task not found');
    } else if (dto.attached_to_type === UploadIntentAttachedToType.user) {
      // Allow uploading an avatar for yourself, or for any visible user in
      // the tenant (e.g., HR setting someone's avatar). RLS hides outsiders.
      if (!dto.attached_to_id) {
        throw new BadRequestException('attached_to_id is required for user uploads');
      }
      const user = await db.user.findUnique({
        where: { id: dto.attached_to_id },
        select: { id: true, deletedAt: true },
      });
      if (!user || user.deletedAt) throw new NotFoundException('User not found');
    } else if (dto.attached_to_type === UploadIntentAttachedToType.company) {
      if (dto.attached_to_id && dto.attached_to_id !== tenant.companyId) {
        throw new BadRequestException('Cannot upload a company logo for another company');
      }
    }
    const ownerId =
      dto.attached_to_type === UploadIntentAttachedToType.company
        ? tenant.companyId
        : dto.attached_to_id!;

    // 4. Generate the row + R2 key. The key embeds company_id so the bucket
    //    layout is structurally tenant-isolated even if RLS were bypassed.
    const fileId = randomUUID();
    const safeFilename = dto.filename.replace(/[^\w.\-]/g, '_');
    const r2Key = `${tenant.companyId}/${fileId}/${safeFilename}`;

    // 5. Sign the upload URL. ContentLength would lock the size, but R2's
    //    SDK currently treats it strictly and the browser sends
    //    Content-Length automatically when uploading a Blob — so we pin
    //    just content-type and rely on the DTO + bucket lifecycle rules
    //    for the size ceiling.
    const presigned = await this.r2.generatePresignedUploadUrl({
      key: r2Key,
      contentType: dto.mime_type,
    });

    // 6. Insert the pending row. RLS scopes on tenant.companyId.
    await db.file.create({
      data: {
        id: fileId,
        companyId: tenant.companyId,
        uploaderUserId: tenant.userId,
        purpose: dto.purpose,
        ownerType: dto.attached_to_type,
        ownerId,
        r2Key,
        originalFilename: dto.filename,
        contentType: dto.mime_type,
        sizeBytes: BigInt(dto.size_bytes),
        uploadStatus: 'pending_upload',
      },
    });

    return {
      file_id: fileId,
      upload_url: presigned.url,
      upload_headers: presigned.headers,
      expires_in_seconds: presigned.expiresInSeconds,
      r2_key: r2Key,
      max_size_bytes: UPLOAD_MAX_BYTES,
    };
  }
}
