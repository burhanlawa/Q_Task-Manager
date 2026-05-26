import {
  Body,
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
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateBranchDto } from './dto/create-branch.dto';
import { BranchListStatus, ListBranchesQuery } from './dto/list-branches.query';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class BranchesController {
  @Get()
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListBranchesQuery) {
    const status = q.status ?? BranchListStatus.Active;
    const where =
      status === BranchListStatus.All
        ? {}
        : status === BranchListStatus.Archived
          ? { NOT: { deletedAt: null } }
          : { deletedAt: null };
    return db.branch.findMany({ where, orderBy: [{ createdAt: 'asc' }] });
  }

  @Post()
  @RequirePermissions('branch.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateBranchDto,
  ) {
    return db.branch.create({
      data: { ...dto, companyId: tenant.companyId },
    });
  }

  @Get(':id')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  @Patch(':id')
  @RequirePermissions('branch.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    const result = await db.branch.updateMany({
      where: { id, deletedAt: null },
      data: dto,
    });
    if (result.count === 0) throw new NotFoundException('Branch not found');
    return db.branch.findUnique({ where: { id } });
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('branch.archive')
  async archive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.branch.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Branch not found');
    return { archived: true };
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions('branch.archive')
  async unarchive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.branch.updateMany({
      where: { id, NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
    if (result.count === 0) throw new NotFoundException('Archived branch not found');
    return { archived: false };
  }
}
