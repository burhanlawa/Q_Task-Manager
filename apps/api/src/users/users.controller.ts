import {
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
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
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
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListUsersQuery) {
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
    return db.user.findMany({
      where: {
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
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
    return this.users.inviteToTenant(db, tenant.companyId, dto);
  }

  @Get(':id')
  @RequirePermissions('user.read')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const user = await db.user.findUnique({
      where: { id },
      select: {
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
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Patch(':id')
  @RequirePermissions('user.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const data: Prisma.UserUpdateManyMutationInput & {
      branchId?: string | null;
      departmentId?: string | null;
    } = {};
    for (const k of ['firstName', 'lastName', 'displayName', 'phone', 'timezone'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.orgRole !== undefined) data.orgRole = dto.orgRole;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;

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
}
