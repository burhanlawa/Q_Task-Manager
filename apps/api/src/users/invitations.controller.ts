import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { CurrentTenant, TenantDb, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { RejectApprovalDto } from './dto/reject-approval.dto';
import { UsersService } from './users.service';

/**
 * Routes for the onboarding-approval state machine (Sprint 7 task 7.3).
 *
 * Note: these are under /invitations rather than /users/:id/approval so the
 * UI can poll a single list ("what's pending for me?") without iterating
 * users. The currentStepIndex + chain on each row tells the UI whether the
 * viewer is the next approver.
 *
 * Permission gate: user.create — same as the invite endpoint itself, since
 * approving an invite IS the meaningful invite action when the inviter's
 * role is below the chain.
 */
@Controller('invitations')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class InvitationsController {
  constructor(
    private readonly users: UsersService,
    private readonly admin: PrismaAdminService,
  ) {}

  /** List all in-flight (status='pending') approvals in this tenant. */
  @Get()
  @RequirePermissions('user.create')
  async list(@TenantDb() db: Prisma.TransactionClient) {
    return db.userInvitationApproval.findMany({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('user.create')
  async approve(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) approvalId: string,
  ) {
    const approverOrgRole = await this.getActorOrgRole(tenant.userId);
    await this.users.assertCanApprove(db, tenant.userId, approverOrgRole, approvalId);
    return this.users.advanceApproval(db, tenant.userId, approvalId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('user.create')
  async reject(
    @TenantDb() db: Prisma.TransactionClient,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) approvalId: string,
    @Body() dto: RejectApprovalDto,
  ) {
    const approverOrgRole = await this.getActorOrgRole(tenant.userId);
    await this.users.assertCanApprove(db, tenant.userId, approverOrgRole, approvalId);
    await this.users.rejectApproval(db, tenant.userId, approvalId, dto.reason);
    return { rejected: true };
  }

  private async getActorOrgRole(userId: string): Promise<string> {
    const u = await this.admin.user.findUnique({
      where: { id: userId },
      select: { orgRole: true },
    });
    if (!u) throw new NotFoundException('Actor not found');
    return u.orgRole;
  }
}
