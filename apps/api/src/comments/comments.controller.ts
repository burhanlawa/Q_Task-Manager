import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
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
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

// 15-minute edit window per the spec. After this, PATCH returns 409 and the
// row is immutable (server-side; UI also greys out the button).
const EDIT_WINDOW_MS = 15 * 60 * 1000;

@Controller()
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class CommentsController {
  constructor(private readonly activity: ActivityLogService) {}

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

    return {
      items: rows.map((r) => ({
        ...r,
        author: authorById.get(r.authorUserId) ?? null,
        // Flatten the relation to a string[] — caller doesn't need the
        // intermediate object shape.
        mentioned_user_ids: r.mentions.map((m) => m.mentionedUserId),
        mentions: undefined,
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

    const mentionIds = await this.validateMentions(db, dto.mentioned_user_ids);

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
    }

    await this.activity.record({
      db,
      companyId: tenant.companyId,
      actorUserId: tenant.userId,
      actionType: 'comment_created',
      targetType: 'comment',
      targetId: comment.id,
      metadata: { taskId, mentionCount: mentionIds.length },
    });

    return { ...comment, mentioned_user_ids: mentionIds };
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

    const nextMentions = await this.validateMentions(db, dto.mentioned_user_ids);
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
