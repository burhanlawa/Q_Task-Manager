import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ClerkClient } from '@clerk/backend';
import { Prisma } from '@prisma/client';
import { CLERK_CLIENT } from '../auth/clerk-client.provider';
import type { CreateUserDto } from './dto/create-user.dto';

// Org roles whose invites skip the approval chain entirely. Founders &
// company-wide admins are trusted to invite directly.
const ROLES_THAT_BYPASS_APPROVAL = new Set(['ceo', 'admin']);

export type InviteResult =
  | { kind: 'invited'; userId: string; email: string; status: 'invited' }
  | {
      kind: 'pending_approval';
      userId: string;
      email: string;
      approvalId: string;
      nextApproverRole: string;
    };

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(@Inject(CLERK_CLIENT) private readonly clerk: ClerkClient) {}

  /**
   * Invite a user into the current tenant. Branches on inviter's org role:
   *  - CEO/Admin → call Clerk immediately, user lands at status='invited',
   *    no approval row.
   *  - Anyone else → create an approval row in 'pending' state; do NOT call
   *    Clerk yet. The final approveStep() call fires the Clerk invitation.
   *
   * Either way, on P2002 (email collision in this tenant) we 409.
   */
  async inviteToTenant(
    db: Prisma.TransactionClient,
    companyId: string,
    inviterUserId: string,
    inviterOrgRole: string,
    dto: CreateUserDto,
  ): Promise<InviteResult> {
    const displayName =
      [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim() || dto.email.split('@')[0];

    let user;
    try {
      user = await db.user.create({
        data: {
          companyId,
          branchId: dto.branchId ?? null,
          departmentId: dto.departmentId ?? null,
          email: dto.email,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          displayName,
          orgRole: dto.orgRole ?? 'employee',
          status: 'invited',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A user with this email already exists in your company');
      }
      throw err;
    }

    // Fast path: CEO/Admin invites bypass approvals.
    if (ROLES_THAT_BYPASS_APPROVAL.has(inviterOrgRole)) {
      await this.sendClerkInvite(db, user.id, user.email);
      return { kind: 'invited', userId: user.id, email: user.email, status: 'invited' };
    }

    // Approval path: read the company's chain, drop any steps that match the
    // inviter's own role (they can't approve themselves), record the row.
    const settings = await db.companySetting.findUnique({
      where: { companyId },
      select: { onboardingApprovalChain: true },
    });
    const rawChain = Array.isArray(settings?.onboardingApprovalChain)
      ? settings!.onboardingApprovalChain
      : [];
    const chain = (rawChain as unknown[])
      .filter((s): s is string => typeof s === 'string')
      .filter((step) => step.toLowerCase() !== inviterOrgRole.toLowerCase());

    if (chain.length === 0) {
      // Inviter's role exhausts the chain (e.g. a Manager invites and the
      // chain is just ['manager']). Treat as auto-approved.
      await this.sendClerkInvite(db, user.id, user.email);
      return { kind: 'invited', userId: user.id, email: user.email, status: 'invited' };
    }

    const approval = await db.userInvitationApproval.create({
      data: {
        companyId,
        invitedUserId: user.id,
        invitedByUserId: inviterUserId,
        chain,
        currentStepIndex: 0,
        status: 'pending',
      },
    });

    return {
      kind: 'pending_approval',
      userId: user.id,
      email: user.email,
      approvalId: approval.id,
      nextApproverRole: chain[0],
    };
  }

  /**
   * Advance the approval chain one step. Caller must already be verified as
   * holding the role at `approval.chain[approval.currentStepIndex]`.
   *  - If more steps remain → bump currentStepIndex.
   *  - If this was the last step → mark approved, fire Clerk invitation.
   *
   * Returns the next approver role (or null if approval is complete).
   */
  async advanceApproval(
    db: Prisma.TransactionClient,
    approverUserId: string,
    approvalId: string,
  ): Promise<{ status: 'pending' | 'approved'; nextApproverRole: string | null }> {
    const approval = await db.userInvitationApproval.findFirst({
      where: { id: approvalId, status: 'pending' },
    });
    if (!approval) throw new NotFoundException('Pending approval not found');

    const chain = (approval.chain as string[]) ?? [];
    const isLastStep = approval.currentStepIndex >= chain.length - 1;

    if (isLastStep) {
      await db.userInvitationApproval.update({
        where: { id: approval.id },
        data: { status: 'approved', decidedAt: new Date(), decidedByUserId: approverUserId },
      });
      const invitee = await db.user.findUnique({
        where: { id: approval.invitedUserId },
        select: { email: true },
      });
      if (!invitee) throw new NotFoundException('Invitee row missing');
      await this.sendClerkInvite(db, approval.invitedUserId, invitee.email);
      return { status: 'approved', nextApproverRole: null };
    }

    const next = await db.userInvitationApproval.update({
      where: { id: approval.id },
      data: { currentStepIndex: approval.currentStepIndex + 1 },
    });
    return { status: 'pending', nextApproverRole: chain[next.currentStepIndex] };
  }

  /**
   * Reject an approval. Marks the row + leaves the local user row alone
   * (status='invited' with no clerk_user_id) — caller can hard-delete later.
   */
  async rejectApproval(
    db: Prisma.TransactionClient,
    approverUserId: string,
    approvalId: string,
    reason: string | undefined,
  ): Promise<void> {
    const approval = await db.userInvitationApproval.findFirst({
      where: { id: approvalId, status: 'pending' },
      select: { invitedUserId: true },
    });
    if (!approval) throw new NotFoundException('Pending approval not found');
    await db.userInvitationApproval.update({
      where: { id: approvalId },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        decidedByUserId: approverUserId,
        rejectionReason: reason ?? null,
      },
    });
    // Hard-delete the pre-created local user row so the email slot frees up
    // for re-invitation. The approval row remains as the audit trail.
    await db.user.delete({ where: { id: approval.invitedUserId } }).catch(() => undefined);
  }

  /**
   * Verify the caller is allowed to act on this approval — i.e. their org_role
   * matches the chain step. Throws 403 otherwise. Returns the approval.
   */
  async assertCanApprove(
    db: Prisma.TransactionClient,
    approverUserId: string,
    approverOrgRole: string,
    approvalId: string,
  ): Promise<{
    id: string;
    invitedUserId: string;
    chain: string[];
    currentStepIndex: number;
  }> {
    const approval = await db.userInvitationApproval.findFirst({
      where: { id: approvalId, status: 'pending' },
    });
    if (!approval) throw new NotFoundException('Pending approval not found');
    const chain = (approval.chain as string[]) ?? [];
    const expectedRole = chain[approval.currentStepIndex];
    if (!expectedRole) throw new BadRequestException('Approval chain is empty');
    // CEO and Admin bypass the role-match check — they're the universal
    // escape hatch. (They wouldn't normally hit this code path because their
    // own invites skip the chain entirely, but they CAN approve other people's
    // pending approvals when needed.)
    const isWildcardRole = ROLES_THAT_BYPASS_APPROVAL.has(approverOrgRole.toLowerCase());
    if (!isWildcardRole && expectedRole.toLowerCase() !== approverOrgRole.toLowerCase()) {
      throw new ForbiddenException(
        `This step needs an approver with role '${expectedRole}', you are '${approverOrgRole}'`,
      );
    }
    // Belt-and-suspenders: don't let the inviter or invitee approve themselves.
    if (approverUserId === approval.invitedByUserId) {
      throw new ForbiddenException('You cannot approve an invite you originated');
    }
    if (approverUserId === approval.invitedUserId) {
      throw new ForbiddenException('You cannot approve your own invitation');
    }
    return {
      id: approval.id,
      invitedUserId: approval.invitedUserId,
      chain,
      currentStepIndex: approval.currentStepIndex,
    };
  }

  /**
   * Extracted Clerk-invite call. Used immediately on CEO/Admin invites, and
   * deferred until final approval lands for everyone else. publicMetadata
   * carries the local user id so the Clerk dashboard is easier to triage.
   */
  private async sendClerkInvite(
    db: Prisma.TransactionClient,
    userId: string,
    email: string,
  ): Promise<void> {
    try {
      await this.clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { qtmInvitedUserId: userId },
      });
    } catch (err) {
      this.log.warn(`Clerk createInvitation failed for ${email}; rolling back local row`);
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
      const message =
        err && typeof err === 'object' && 'errors' in err
          ? JSON.stringify((err as { errors: unknown }).errors)
          : (err as Error)?.message;
      throw new BadRequestException(`Could not send invitation: ${message}`);
    }
  }
}
