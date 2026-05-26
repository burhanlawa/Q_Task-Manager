import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQuery } from './dto/list-departments.query';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class DepartmentsController {
  @Get()
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListDepartmentsQuery) {
    return db.department.findMany({
      where: {
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.includeArchived ? {} : { deletedAt: null }),
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('department.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateDepartmentDto,
  ) {
    if (dto.parentDepartmentId) {
      const parent = await db.department.findUnique({
        where: { id: dto.parentDepartmentId },
        select: { branchId: true, deletedAt: true },
      });
      if (!parent || parent.deletedAt) throw new NotFoundException('Parent department not found');
      if (parent.branchId !== dto.branchId) {
        throw new BadRequestException('Parent department is in a different branch');
      }
    }
    try {
      return await db.department.create({
        data: {
          companyId: tenant.companyId,
          branchId: dto.branchId,
          parentDepartmentId: dto.parentDepartmentId ?? null,
          name: dto.name,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'A sibling department with this name already exists in the same branch/parent',
        );
      }
      throw err;
    }
  }

  @Get(':id')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const dept = await db.department.findUnique({ where: { id } });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  @Patch(':id')
  @RequirePermissions('department.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    // Reparenting needs a cycle check: walk up from the proposed parent and
    // make sure we never hit `id` itself.
    if (dto.parentDepartmentId !== undefined && dto.parentDepartmentId !== null) {
      if (dto.parentDepartmentId === id) {
        throw new BadRequestException('A department cannot be its own parent');
      }
      let cursor: string | null = dto.parentDepartmentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) throw new BadRequestException('Reparent would create a cycle');
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const parent: { parentDepartmentId: string | null } | null = await db.department.findUnique(
          {
            where: { id: cursor },
            select: { parentDepartmentId: true },
          },
        );
        if (!parent) throw new NotFoundException('Proposed parent not found');
        cursor = parent.parentDepartmentId;
      }
    }

    const data: Prisma.DepartmentUpdateManyMutationInput & { parentDepartmentId?: string | null } =
      {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.parentDepartmentId !== undefined) data.parentDepartmentId = dto.parentDepartmentId;

    try {
      const result = await db.department.updateMany({
        where: { id, deletedAt: null },
        data,
      });
      if (result.count === 0) throw new NotFoundException('Department not found');
      return db.department.findUnique({ where: { id } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'A sibling department with this name already exists in the same branch/parent',
        );
      }
      throw err;
    }
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('department.archive')
  async archive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // Refuse to archive a department that still has active children.
    const activeChildren = await db.department.count({
      where: { parentDepartmentId: id, deletedAt: null },
    });
    if (activeChildren > 0) {
      throw new BadRequestException(
        `Cannot archive: ${activeChildren} active child department(s). Archive or reparent them first.`,
      );
    }
    const result = await db.department.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Department not found');
    return { archived: true };
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions('department.archive')
  async unarchive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.department.updateMany({
      where: { id, NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
    if (result.count === 0) throw new NotFoundException('Archived department not found');
    return { archived: false };
  }
}
