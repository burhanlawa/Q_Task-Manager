import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ActivityLogService } from '../activity-log/activity-log.service';
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
import { storageLimitBytes } from './plan-storage-limit';

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
  constructor(
    private readonly r2: R2Service,
    private readonly activity: ActivityLogService,
  ) {}

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

    // 4. Plan storage limit (Sprint 11.8). Reject up-front if the new file
    //    would push the tenant past its plan's cap. growth's "+1 GB/user"
    //    component scales with the current active-user count (RLS-scoped
    //    so we see only this tenant's users).
    const [company, activeUserCount] = await Promise.all([
      db.company.findUnique({
        where: { id: tenant.companyId },
        select: { plan: true, storageUsedBytes: true },
      }),
      db.user.count({ where: { status: 'active', deletedAt: null } }),
    ]);
    if (!company) throw new NotFoundException('Company not found');
    const limit = storageLimitBytes(company.plan, activeUserCount);
    const prospective = company.storageUsedBytes + BigInt(dto.size_bytes);
    if (prospective > limit) {
      throw new UnprocessableEntityException({
        message: `Upload would exceed your plan's storage limit (${limit} bytes; in use ${company.storageUsedBytes}; this file ${dto.size_bytes}).`,
        plan: company.plan,
        limit_bytes: limit.toString(),
        used_bytes: company.storageUsedBytes.toString(),
        attempted_bytes: dto.size_bytes,
      });
    }

    // 5. Generate the row + R2 key. The key embeds company_id so the bucket
    //    layout is structurally tenant-isolated even if RLS were bypassed.
    const fileId = randomUUID();
    const safeFilename = dto.filename.replace(/[^\w.\-]/g, '_');
    const r2Key = `${tenant.companyId}/${fileId}/${safeFilename}`;

    // 6. Sign the upload URL. ContentLength would lock the size, but R2's
    //    SDK currently treats it strictly and the browser sends
    //    Content-Length automatically when uploading a Blob — so we pin
    //    just content-type and rely on the DTO + bucket lifecycle rules
    //    for the size ceiling.
    const presigned = await this.r2.generatePresignedUploadUrl({
      key: r2Key,
      contentType: dto.mime_type,
    });

    // 7. Insert the pending row. RLS scopes on tenant.companyId.
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

  // POST /files/:id/complete
  //   Marks an upload as finished. Idempotent: calling on an already-
  //   'uploaded' row returns 200 with the row (so a retried client request
  //   doesn't surprise itself with a 409). RLS scopes to this tenant.
  //   Only the original uploader can complete — otherwise a second user
  //   could finalize a half-uploaded file they didn't own.
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('file.upload')
  async complete(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const file = await db.file.findUnique({ where: { id } });
    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    if (file.uploaderUserId !== tenant.userId) {
      throw new ForbiddenException('Only the uploader can complete this upload');
    }

    if (file.uploadStatus === 'uploaded') {
      // Idempotent path. Don't write a second activity_log entry.
      return serializeFile(file);
    }
    if (file.uploadStatus !== 'pending_upload') {
      throw new ConflictException(`Cannot complete a file in status '${file.uploadStatus}'`);
    }

    const updated = await db.file.update({
      where: { id },
      data: { uploadStatus: 'uploaded' },
    });

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'file_uploaded',
      targetType: 'file',
      targetId: id,
      metadata: {
        purpose: file.purpose,
        ownerType: file.ownerType,
        ownerId: file.ownerId,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes.toString(),
      },
    });

    return serializeFile(updated);
  }

  // GET /files/:id/download
  //   Returns a 5-minute pre-signed GET URL for the file and writes a
  //   file_downloaded activity_log entry so we have an audit trail of who
  //   pulled the file and when. RLS scopes read access to the tenant; an
  //   explicit 409 keeps us from serving half-written objects (uploads in
  //   pending_upload state).
  //
  //   The pre-signed URL is valid for the full TTL once issued — R2 has
  //   no native single-use mechanism. The audit row is per /download call
  //   rather than per byte stream; that's the right granularity for "who
  //   requested access" logging.
  @Get(':id/download')
  @RequirePermissions('file.read')
  async download(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const file = await db.file.findUnique({
      where: { id },
      select: {
        id: true,
        r2Key: true,
        uploadStatus: true,
        deletedAt: true,
        contentType: true,
        originalFilename: true,
        purpose: true,
        ownerType: true,
        ownerId: true,
      },
    });
    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    if (file.uploadStatus !== 'uploaded') {
      throw new ConflictException(`File is not ready for download (status: ${file.uploadStatus})`);
    }

    const signed = await this.r2.generatePresignedDownloadUrl({ key: file.r2Key });

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'file_downloaded',
      targetType: 'file',
      targetId: id,
      metadata: {
        purpose: file.purpose,
        ownerType: file.ownerType,
        ownerId: file.ownerId,
        contentType: file.contentType,
        ttlSeconds: signed.expiresInSeconds,
      },
    });

    return {
      download_url: signed.url,
      expires_in_seconds: signed.expiresInSeconds,
      content_type: file.contentType,
      original_filename: file.originalFilename,
    };
  }
}

// JSON.stringify can't handle BigInt — convert size_bytes to a string before
// the controller's response leaves Nest's JSON serializer. Keep the camelCase
// names that match the Prisma model.
function serializeFile<T extends { sizeBytes: bigint }>(
  f: T,
): Omit<T, 'sizeBytes'> & { sizeBytes: string } {
  return { ...f, sizeBytes: f.sizeBytes.toString() };
}
