import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { MentionParserService } from './mention-parser.service';

// 15-minute edit window per the spec. After this, PATCH returns 409 and the
// row is immutable (server-side; UI also greys out the button).
const EDIT_WINDOW_MS = 15 * 60 * 1000;

@Controller()
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class CommentsController {
  constructor(
    private readonly activity: ActivityLogService,
    private readonly mentionParser: MentionParserService,
    private readonly notifications: NotificationsService,
  ) {}

  // GET /tasks/:id/comments
  //   Oldest first (chronological is the natural reading order for threads).
  //   Mentions + author inlined so the panel renders without a follow-up
  //   users call. Soft-deleted rows excluded.
  @Get('tasks/:id/comments')
  @RequirePermissions('comment.read')
  async list(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) taskId: string,
  ) {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new NotFoundException('Task not found');

    const rows = await db.comment.findMany({
      where: { taskId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        mentions: { select: { mentionedUserId: true } },
      },
    });
    // Inline a small author profile alongside each comment.
    const authorIds = Array.from(new Set(rows.map((r) => r.authorUserId)));
    const authors = authorIds.length
      ? await db.user.findMany({
          where: { id: { in: authorIds } },
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarFileId: true,
          },
        })
      : [];
    const authorById = new Map(authors.map((a) => [a.id, a]));

    // Inline attachments per comment. Same pattern as task attachments —
    // owner_type='comment' + owner_id matches the comment id. Only
    // 'uploaded' rows render to avoid showing half-uploaded files.
    const attachments = rows.length
      ? await db.file.findMany({
          where: {
            ownerType: 'comment',
            ownerId: { in: rows.map((r) => r.id) },
            uploadStatus: 'uploaded',
            deletedAt: null,
          },
          select: {
            id: true,
            ownerId: true,
            originalFilename: true,
            contentType: true,
            sizeBytes: true,
            createdAt: true,
          },
        })
      : [];
    const attByComment = new Map<string, typeof attachments>();
    for (const a of attachments) {
      const k = a.ownerId!;
      if (!attByComment.has(k)) attByComment.set(k, []);
      attByComment.get(k)!.push(a);
    }

    return {
      items: rows.map((r) => ({
        ...r,
        author: authorById.get(r.authorUserId) ?? null,
        // Flatten the relation to a string[] — caller doesn't need the
        // intermediate object shape.
        mentioned_user_ids: r.mentions.map((m) => m.mentionedUserId),
        mentions: undefined,
        attachments: (attByComment.get(r.id) ?? []).map((a) => ({
          id: a.id,
          original_filename: a.originalFilename,
          content_type: a.contentType,
          size_bytes: a.sizeBytes.toString(),
          created_at: a.createdAt,
        })),
      })),
    };
  }

  // POST /tasks/:id/comments
  //   Body: { body, mentioned_user_ids?[] }. Author = caller. Inserts the
  //   comment row + the de-duped mentions in one transaction so a failure
  //   in either rolls both back.
  @Post('tasks/:id/comments')
  @RequirePermissions('comment.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, deletedAt: true },
    });
    if (!task || task.deletedAt) throw new NotFoundException('Task not found');

    // Two sources of mentions, unioned + de-duped:
    //   - explicit IDs from the TipTap mention extension (when it lands)
    //   - text parsed from the body for plain "@alice" tokens
    const explicit = await this.validateMentions(db, dto.mentioned_user_ids);
    const parsed = await this.mentionParser.parse(db, dto.body);
    const mentionIds = Array.from(new Set([...explicit, ...parsed]));

    const comment = await db.comment.create({
      data: {
        companyId: tenant.companyId,
        taskId,
        authorUserId: tenant.userId,
        body: dto.body,
      },
    });

    if (mentionIds.length > 0) {
      await db.commentMention.createMany({
        data: mentionIds.map((userId) => ({
          companyId: tenant.companyId,
          commentId: comment.id,
          mentionedUserId: userId,
        })),
      });
      for (const userId of mentionIds) {
        if (userId === tenant.userId) continue;
        await this.notifications.create(db, {
          recipientId: userId,
          companyId: tenant.companyId,
          type: 'comment_mentioned',
          message: 'You were mentioned in a comment.',
          relatedEntityType: 'comment',
          relatedEntityId: comment.id,
          actionUrl: `/tasks/${taskId}#comment-${comment.id}`,
          actorUserId: tenant.userId,
          metadata: { taskId, commentId: comment.id },
        });
      }
    }

    // Claim any uploaded comment_attachment files (Sprint 13.4). Each file
    // must be the caller's own upload, of the right purpose, not yet
    // claimed (owner_id is null), and the upload must have completed.
    // We update each via updateMany so a mismatched row simply doesn't
    // update — never raises a partial-failure exception that would leave
    // the comment in an inconsistent state.
    const attachmentIds = dto.attachment_file_ids ?? [];
    let claimedCount = 0;
    if (attachmentIds.length > 0) {
      const verify = await db.file.findMany({
        where: {
          id: { in: attachmentIds },
          uploaderUserId: tenant.userId,
          purpose: 'comment_attachment',
          ownerType: 'comment',
          ownerId: null,
          uploadStatus: 'uploaded',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (verify.length !== attachmentIds.length) {
        throw new BadRequestException(
          'One or more attachments are not claimable (already attached, not yours, or not yet uploaded)',
        );
      }
      const r = await db.file.updateMany({
        where: { id: { in: attachmentIds } },
        data: { ownerId: comment.id },
      });
      claimedCount = r.count;
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'comment_created',
      targetType: 'comment',
      targetId: comment.id,
      metadata: {
        taskId,
        mentionCount: mentionIds.length,
        attachmentCount: claimedCount,
      },
    });

    return {
      ...comment,
      mentioned_user_ids: mentionIds,
      attachment_file_ids: attachmentIds,
    };
  }

  // PATCH /comments/:id
  //   Author-only, within 15 minutes of creation. Replaces the mention set
  //   to match the new body (computed by diff against existing rows so the
  //   trigger trail stays clean).
  @Patch('comments/:id')
  @RequirePermissions('comment.create')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    const existing = await db.comment.findUnique({
      where: { id },
      include: { mentions: { select: { mentionedUserId: true } } },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('Comment not found');

    if (existing.authorUserId !== tenant.userId) {
      throw new ForbiddenException('Only the author can edit this comment');
    }

    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      throw new ConflictException(
        'This comment is older than 15 minutes and can no longer be edited.',
      );
    }

    const explicit = await this.validateMentions(db, dto.mentioned_user_ids);
    const parsed = await this.mentionParser.parse(db, dto.body);
    const nextMentions = Array.from(new Set([...explicit, ...parsed]));
    const prevMentions = new Set(existing.mentions.map((m) => m.mentionedUserId));
    const nextSet = new Set(nextMentions);
    const toAdd = nextMentions.filter((u) => !prevMentions.has(u));
    const toRemove = existing.mentions.map((m) => m.mentionedUserId).filter((u) => !nextSet.has(u));

    const updated = await db.comment.update({
      where: { id },
      data: {
        body: dto.body,
        editedAt: new Date(),
      },
    });

    if (toRemove.length > 0) {
      await db.commentMention.deleteMany({
        where: { commentId: id, mentionedUserId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await db.commentMention.createMany({
        data: toAdd.map((userId) => ({
          companyId: tenant.companyId,
          commentId: id,
          mentionedUserId: userId,
        })),
      });
      for (const userId of toAdd) {
        if (userId === tenant.userId) continue;
        await this.notifications.create(db, {
          recipientId: userId,
          companyId: tenant.companyId,
          type: 'comment_mentioned',
          message: 'You were mentioned in a comment.',
          relatedEntityType: 'comment',
          relatedEntityId: id,
          actionUrl: `/tasks/${existing.taskId}#comment-${id}`,
          actorUserId: tenant.userId,
          metadata: { taskId: existing.taskId, commentId: id },
        });
      }
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'comment_updated',
      targetType: 'comment',
      targetId: id,
      metadata: {
        taskId: existing.taskId,
        ageMs,
        added: toAdd.length,
        removed: toRemove.length,
      },
    });

    return { ...updated, mentioned_user_ids: nextMentions };
  }

  // DELETE /comments/:id
  //   Soft-delete (sets deleted_at). Author-only. No 15-min window — users
  //   should be able to retract their own old comments even past the edit
  //   window. Idempotent: deleting an already-deleted comment returns 204.
  @Delete('comments/:id')
  @HttpCode(204)
  @RequirePermissions('comment.create')
  async remove(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const existing = await db.comment.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, taskId: true, deletedAt: true },
    });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorUserId !== tenant.userId) {
      throw new ForbiddenException('Only the author can delete this comment');
    }
    if (existing.deletedAt) return; // idempotent

    await db.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'comment_deleted',
      targetType: 'comment',
      targetId: id,
      metadata: { taskId: existing.taskId },
    });
  }

  // Mentions must be active users in this tenant. RLS hides cross-tenant
  // rows; a count mismatch implies the client sent ids we can't see.
  private async validateMentions(
    db: Prisma.TransactionClient,
    rawIds: string[] | undefined,
  ): Promise<string[]> {
    const ids = Array.from(new Set(rawIds ?? []));
    if (ids.length === 0) return [];
    const found = await db.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('One or more mentioned users were not found in this tenant');
    }
    return ids;
  }
}
