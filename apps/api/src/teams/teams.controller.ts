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
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { CreateTeamDto } from './dto/create-team.dto';
import { ListTeamsQuery, TeamListStatus } from './dto/list-teams.query';
import { UpdateTeamDto } from './dto/update-team.dto';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function assertSupervisorInTenant(
  db: Prisma.TransactionClient,
  supervisorId: string,
): Promise<void> {
  // RLS already scopes this lookup to the current tenant, so a hit means the
  // supervisor belongs to our company. A miss is either cross-tenant (RLS
  // hides it) or a non-existent UUID — same response either way.
  const user = await db.user.findUnique({
    where: { id: supervisorId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    throw new BadRequestException('supervisorId does not match an active user in this tenant');
  }
}

@Controller('teams')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class TeamsController {
  @Get()
  async list(@TenantDb() db: Prisma.TransactionClient, @Query() q: ListTeamsQuery) {
    const status = q.status ?? TeamListStatus.Active;
    const statusWhere =
      status === TeamListStatus.All
        ? {}
        : status === TeamListStatus.Archived
          ? { NOT: { deletedAt: null } }
          : { deletedAt: null };
    return db.team.findMany({
      where: { ...(q.departmentId ? { departmentId: q.departmentId } : {}), ...statusWhere },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('team.create')
  async create(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTeamDto,
  ) {
    const dept = await db.department.findUnique({
      where: { id: dto.departmentId },
      select: { id: true, deletedAt: true },
    });
    if (!dept || dept.deletedAt) throw new NotFoundException('Department not found');

    if (dto.supervisorId) await assertSupervisorInTenant(db, dto.supervisorId);

    try {
      return await db.team.create({
        data: {
          companyId: tenant.companyId,
          departmentId: dto.departmentId,
          supervisorId: dto.supervisorId ?? null,
          name: dto.name,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A team with this name already exists in the same department');
      }
      throw err;
    }
  }

  @Get(':id')
  async get(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const team = await db.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  @Patch(':id')
  @RequirePermissions('team.update')
  async update(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    if (dto.supervisorId !== undefined && dto.supervisorId !== null) {
      await assertSupervisorInTenant(db, dto.supervisorId);
    }

    const data: Prisma.TeamUpdateManyMutationInput & { supervisorId?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.supervisorId !== undefined) data.supervisorId = dto.supervisorId;

    try {
      const result = await db.team.updateMany({
        where: { id, deletedAt: null },
        data,
      });
      if (result.count === 0) throw new NotFoundException('Team not found');
      return db.team.findUnique({ where: { id } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A team with this name already exists in the same department');
      }
      throw err;
    }
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('team.archive')
  async archive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.team.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Team not found');
    return { archived: true };
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions('team.archive')
  async unarchive(
    @TenantDb() db: Prisma.TransactionClient,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await db.team.updateMany({
      where: { id, NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
    if (result.count === 0) throw new NotFoundException('Archived team not found');
    return { archived: false };
  }
}
