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
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { AddUserTeamDto } from './dto/add-user-team.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AssignSystemRoleDto } from './dto/assign-system-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery, UserListStatus } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Controller('users')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly activity: ActivityLogService,
    private readonly admin: PrismaAdminService,
    private readonly crypto: CryptoService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('user.read')
  async list(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Query() q: ListUsersQuery,
  ) {
    // status semantics:
    //   - active / invited / suspended → filter by enum AND not soft-deleted
    //   - deactivated → filter by enum, INCLUDE soft-deleted (archive sets
    //     status='deactivated' AND deletedAt=now() together)
    //   - all → every status except soft-deleted (callers wanting archived
    //     rows ask for status=deactivated explicitly)
    const status = q.status ?? UserListStatus.Active;
    const statusWhere: Prisma.UserWhereInput =
      status === UserListStatus.All
        ? { deletedAt: null }
        : status === UserListStatus.Deactivated
          ? { status: 'deactivated' }
          : { status, deletedAt: null };
    const teamFilter = q.teamId ? { teams: { some: { teamId: q.teamId } } } : {};

    // Authorization scope: callers without user.read.companywide get
    // auto-scoped to their own department. Manager-by-position is the typical
    // example: they have user.read but not user.read.companywide, so /users
    // returns only their dept's people. HR/Admin/CEO have companywide and see
    // the whole tenant unless they apply an explicit departmentId filter.
    const granted = await this.permissions.getEffectivePermissions(tenant.userId);
    const companywide = this.permissions.has(granted, 'user.read.companywide');
    let scopedDepartmentId = q.departmentId;
    if (!companywide) {
      const actorDept = await this.getActorDepartmentId(tenant.userId);
      // If the caller's own dept is unknown, default to "no rows" rather than
      // accidentally exposing the full tenant.
      if (!actorDept) return [];
      // If the caller explicitly filtered by a different department, refuse —
      // they only have visibility into their own.
      if (q.departmentId && q.departmentId !== actorDept) return [];
      scopedDepartmentId = actorDept;
    }

    return db.user.findMany({
      where: {
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
        ...teamFilter,
        ...statusWhere,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        orgRole: true,
        status: true,
        branchId: true,
        departmentId: true,
        locale: true,
        timezone: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('user.create')
  async invite(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateUserDto,
  ) {
    const inviterOrgRole = await this.getActorOrgRole(tenant.userId);
    return this.users.inviteToTenant(db, tenant.companyId, tenant.userId, inviterOrgRole, dto);
  }

  @Get(':id')
  @RequirePermissions('user.read')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('include') include?: string,
  ) {
    const wantSensitive = include === 'sensitive';

    // Opt-in to sensitive fields is gated by a separate permission. We check
    // it here rather than via @RequirePermissions because the same endpoint
    // is dual-purpose (basic profile vs. profile + PII).
    if (wantSensitive) {
      const granted = await this.permissions.getEffectivePermissions(tenant.userId);
      if (!this.permissions.has(granted, 'user.read.sensitive')) {
        throw new ForbiddenException('Missing permission: user.read.sensitive');
      }
    }

    const select: Prisma.UserSelect = {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      phone: true,
      avatarFileId: true,
      locale: true,
      timezone: true,
      orgRole: true,
      status: true,
      employmentStatus: true,
      branchId: true,
      departmentId: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      ...(wantSensitive ? { dateOfBirth: true, nationalId: true } : {}),
    };

    const user = await db.user.findUnique({ where: { id }, select });
    if (!user) throw new NotFoundException('User not found');

    if (wantSensitive) {
      // Decrypt national_id at the API boundary. The DB stores ciphertext as
      // bytea; Prisma returns it as Buffer | null.
      const u = user as typeof user & { nationalId?: Buffer | null };
      const decrypted: string | null = u.nationalId ? this.crypto.decrypt(u.nationalId) : null;
      (u as Record<string, unknown>).nationalId = decrypted;

      // Audit log row is atomic with the read (same per-request tx).
      const fields: string[] = [];
      if ('dateOfBirth' in user) fields.push('date_of_birth');
      if ('nationalId' in user) fields.push('national_id');
      await this.activity.recordSensitiveRead({
        db,
        companyId: tenant.companyId,
        actorUserId: tenant.userId,
        targetUserId: id,
        fields,
      });
    }

    return user;
  }

  private async getActorDepartmentId(userId: string): Promise<string | null> {
    const u = await this.admin.user.findUnique({
      where: { id: userId },
      select: { departmentId: true },
    });
    return u?.departmentId ?? null;
  }

  private async getActorOrgRole(userId: string): Promise<string> {
    const u = await this.admin.user.findUnique({
      where: { id: userId },
      select: { orgRole: true },
    });
    if (!u) throw new NotFoundException('Actor not found');
    return u.orgRole;
  }

  @Patch(':id')
  @RequirePermissions('user.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const data: Prisma.UserUncheckedUpdateManyInput = {};
    for (const k of ['firstName', 'lastName', 'displayName', 'phone', 'timezone'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.orgRole !== undefined) data.orgRole = dto.orgRole;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.nationalId !== undefined) {
      // Encrypt at the API boundary so plaintext never leaves the process.
      // Prisma's bytes input wants Uint8Array<ArrayBuffer>; copy to be safe
      // across Node 22's Buffer<ArrayBufferLike> typing.
      if (dto.nationalId === null) {
        data.nationalId = null;
      } else {
        const blob = this.crypto.encrypt(dto.nationalId);
        // Copy into a fresh ArrayBuffer-backed Uint8Array so the inferred
        // backing type is ArrayBuffer (not ArrayBufferLike), which is what
        // Prisma's bytes field expects under Node 22's stricter Buffer types.
        const out = new Uint8Array(blob.byteLength);
        out.set(blob);
        data.nationalId = out;
      }
    }

    try {
      const result = await db.user.updateMany({
        where: { id, deletedAt: null },
        data,
      });
      if (result.count === 0) throw new NotFoundException('User not found');
      return db.user.findUnique({ where: { id } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Conflict on user update');
      }
      throw err;
    }
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('user.archive')
  async archive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.user.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), status: 'deactivated' },
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    return { archived: true };
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions('user.archive')
  async unarchive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.user.updateMany({
      where: { id, NOT: { deletedAt: null } },
      data: { deletedAt: null, status: 'active' },
    });
    if (result.count === 0) throw new NotFoundException('Archived user not found');
    return { archived: false };
  }

  // ---- team memberships (Sprint 5 task 5.2) ----

  @Get(':id/teams')
  @RequirePermissions('user.read')
  async listTeams(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // RLS scopes the user via UserTeam.user → users.company_id, so we don't
    // need an explicit tenant guard.
    return db.userTeam.findMany({
      where: { userId: id },
      include: { team: { select: { id: true, name: true, departmentId: true, deletedAt: true } } },
      orderBy: [{ joinedAt: 'asc' }],
    });
  }

  @Post(':id/teams')
  @RequirePermissions('user.update')
  async addTeam(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: AddUserTeamDto,
  ) {
    // Verify user and team belong to the current tenant (RLS-filtered lookups).
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    const team = await db.team.findUnique({
      where: { id: dto.teamId },
      select: { id: true, deletedAt: true },
    });
    if (!team || team.deletedAt) throw new NotFoundException('Team not found');

    const wantPrimary = dto.isPrimary === true;

    // The tenant interceptor already wrapped this request in a Prisma
    // transaction, so these two statements are atomic. The DB has a partial
    // unique index on (user_id) WHERE is_primary=true — unset any existing
    // primary first, then upsert this membership.
    if (wantPrimary) {
      await db.userTeam.updateMany({
        where: { userId, isPrimary: true, NOT: { teamId: dto.teamId } },
        data: { isPrimary: false },
      });
    }
    return db.userTeam.upsert({
      where: { userId_teamId: { userId, teamId: dto.teamId } },
      create: { userId, teamId: dto.teamId, isPrimary: wantPrimary },
      update: { isPrimary: wantPrimary },
    });
  }

  @Delete(':id/teams/:teamId')
  @HttpCode(200)
  @RequirePermissions('user.update')
  async removeTeam(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
  ) {
    const result = await db.userTeam.deleteMany({ where: { userId, teamId } });
    if (result.count === 0) {
      throw new NotFoundException('Membership not found');
    }
    return { removed: true };
  }

  // ---- system role grants (Sprint 5 task 5.3) ----

  @Get(':id/system-roles')
  @RequirePermissions('user.read')
  async listSystemRoles(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
  ) {
    return db.userSystemRole.findMany({
      where: { userId },
      select: { systemRole: true, grantedAt: true, grantedBy: true },
      orderBy: [{ grantedAt: 'asc' }],
    });
  }

  @Post(':id/system-roles')
  @RequirePermissions('user.assign_system_role')
  async assignSystemRole(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: AssignSystemRoleDto,
  ) {
    // Verify the target user is in our tenant (RLS-filtered).
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    // Validate the role name exists as an active role in this tenant. We don't
    // require it to be builtin — admins can create custom roles later — but it
    // must exist, otherwise the grant has no effect (PermissionsGuard joins
    // by name and an unmatched name contributes zero permissions).
    const role = await db.role.findFirst({
      where: { name: dto.systemRole, deletedAt: null },
      select: { name: true },
    });
    if (!role) {
      throw new BadRequestException(`systemRole '${dto.systemRole}' is not a role in this tenant`);
    }

    const row = await db.userSystemRole.upsert({
      where: { userId_systemRole: { userId, systemRole: dto.systemRole } },
      create: { userId, systemRole: dto.systemRole, grantedBy: tenant.userId },
      update: { grantedBy: tenant.userId },
    });
    this.permissions.invalidateUser(userId);
    return row;
  }

  @Delete(':id/system-roles/:role')
  @HttpCode(200)
  @RequirePermissions('user.assign_system_role')
  async revokeSystemRole(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Param('role') systemRole: string,
  ) {
    const result = await db.userSystemRole.deleteMany({
      where: { userId, systemRole },
    });
    if (result.count === 0) throw new NotFoundException('Grant not found');
    this.permissions.invalidateUser(userId);
    return { revoked: true };
  }

  // ---- direct role grants via user_roles (Sprint 6 task 6.4) ----

  @Get(':id/roles')
  @RequirePermissions('role.manage')
  async listRoles(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
  ) {
    return db.userRole.findMany({
      where: { userId, role: { deletedAt: null } },
      select: {
        roleId: true,
        grantedAt: true,
        grantedBy: true,
        role: { select: { name: true, isBuiltin: true } },
      },
      orderBy: [{ grantedAt: 'asc' }],
    });
  }

  @Post(':id/roles')
  @RequirePermissions('role.manage')
  async assignRole(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: AssignRoleDto,
  ) {
    // Both lookups are RLS-scoped so the target user + role must belong to
    // the current tenant. RLS misses become 404 — no cross-tenant leak.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    const role = await db.role.findFirst({
      where: { id: dto.roleId, deletedAt: null },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Role not found');

    const row = await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: dto.roleId } },
      create: { userId, roleId: dto.roleId, grantedBy: tenant.userId },
      update: { grantedBy: tenant.userId },
    });
    this.permissions.invalidateUser(userId);
    return row;
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(200)
  @RequirePermissions('role.manage')
  async revokeRole(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ) {
    const result = await db.userRole.deleteMany({ where: { userId, roleId } });
    if (result.count === 0) throw new NotFoundException('Grant not found');
    this.permissions.invalidateUser(userId);
    return { revoked: true };
  }
}
