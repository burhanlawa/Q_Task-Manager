import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PERMISSION_CATALOG } from '../auth/permission-catalog';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { UpdateRoleDto } from './dto/update-role.dto';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Controller('roles')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class RolesController {
  constructor(private readonly activity: ActivityLogService) {}

  @Get('permission-catalog')
  @RequirePermissions('role.manage')
  permissionCatalog() {
    // Static — no DB lookup. Exposed under /roles/* because it's used by the
    // Roles admin UI; same role.manage gate.
    return { groups: PERMISSION_CATALOG };
  }

  @Get()
  @RequirePermissions('role.manage')
  async list(@TenantDb() db: Prisma.TransactionClient) {
    return db.role.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        isBuiltin: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isBuiltin: 'desc' }, { name: 'asc' }],
    });
  }

  @Get(':id')
  @RequirePermissions('role.manage')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const role = await db.role.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        isBuiltin: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  @Patch(':id')
  @RequirePermissions('role.manage')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    // Read the existing role *inside* the request transaction so the audit
    // log row we write below sees a consistent before-snapshot.
    const existing = await db.role.findFirst({
      where: { id, deletedAt: null },
      select: { isBuiltin: true, permissions: true },
    });
    if (!existing) throw new NotFoundException('Role not found');

    // Built-in roles: only permissions are editable. Silently strip name +
    // description so a UI sending the whole object doesn't fail validation.
    const data: Prisma.RoleUncheckedUpdateInput = {};
    if (dto.permissions !== undefined) data.permissions = dto.permissions;
    if (!existing.isBuiltin) {
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
    }

    try {
      const result = await db.role.updateMany({
        where: { id, deletedAt: null },
        data,
      });
      if (result.count === 0) throw new NotFoundException('Role not found');
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A role with this name already exists in this tenant');
      }
      throw err;
    }

    // Audit log: record permission diff if changed. No-op skip lives in the
    // service so we don't write rows for redundant PATCHes (Sprint 6 task 6.6).
    if (dto.permissions !== undefined) {
      const before = (Array.isArray(existing.permissions) ? existing.permissions : []).filter(
        (p): p is string => typeof p === 'string',
      );
      await this.activity.recordRolePermissionsChange({
        db,
        companyId: tenant.companyId,
        actorUserId: tenant.userId,
        roleId: id,
        before,
        after: dto.permissions,
      });
    }

    return db.role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        isBuiltin: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
