import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateTagDto } from './dto/create-tag.dto';
import { ListTagsQuery } from './dto/list-tags.query';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Controller()
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class TagsController {
  // Categories live alongside tags; the picker needs them to drive the
  // "Create new tag" flow (every tag belongs to a category).
  @Get('tag-categories')
  @RequirePermissions('tag.read')
  async categories(@TenantDb() db: Prisma.TransactionClient) {
    return db.tagCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, position: true, isBuiltin: true },
    });
  }

  // List + suggest. Case-insensitive substring match on name (driven by the
  // 10.1 name_lower generated column), capped at `limit` (default 25). Sort
  // by usage_count desc so picker suggestions surface the most-used tags
  // first, then alphabetical to keep ordering stable when counts tie.
  @Get('tags')
  @RequirePermissions('tag.read')
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListTagsQuery) {
    const limit = q.limit ?? 25;
    const where: Prisma.TagWhereInput = {
      deletedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.q && q.q.trim().length > 0
        ? { nameLower: { contains: q.q.trim().toLowerCase() } }
        : {}),
    };
    return db.tag.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      take: limit,
    });
  }

  @Post('tags')
  @RequirePermissions('tag.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTagDto,
  ) {
    // Verify category exists in this tenant; RLS hides cross-tenant rows.
    const category = await db.tagCategory.findUnique({
      where: { id: dto.categoryId },
      select: { id: true, deletedAt: true },
    });
    if (!category || category.deletedAt) {
      throw new NotFoundException('Tag category not found');
    }

    // Server-side dedupe. We could pre-check name_lower and return the
    // existing row, but the spec asks for 409 — let the unique index do the
    // talking (it's a single SQL roundtrip vs. select-then-insert).
    try {
      return await db.tag.create({
        data: {
          companyId: tenant.companyId,
          categoryId: dto.categoryId,
          name: dto.name,
          ...(dto.color ? { color: dto.color } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A tag named '${dto.name}' already exists in this category (case-insensitive)`,
        );
      }
      throw e;
    }
  }
}
