import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ClerkClient } from '@clerk/backend';
import { Prisma } from '@prisma/client';
import { CLERK_CLIENT } from '../auth/clerk-client.provider';
import type { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(@Inject(CLERK_CLIENT) private readonly clerk: ClerkClient) {}

  /**
   * Invite a user into the current tenant.
   *
   * Flow (the "Option B" from the Sprint 5 plan, with a small twist):
   *   1. Pre-create our `users` row inside the tenant with status='invited'
   *      and clerk_user_id=null. Catch a P2002 here as 409 (email already in
   *      tenant).
   *   2. Ask Clerk to create the identity. They send the password-setup email.
   *   3. When the invitee completes signup, the Clerk webhook (3.4) fires.
   *      That handler is updated to look for a pre-created `users` row by
   *      email — if it exists, link clerk_user_id to it instead of
   *      provisioning a brand-new tenant.
   *
   * If Clerk creation fails, we roll back the local users row so the email
   * isn't permanently squatted in our DB.
   */
  async inviteToTenant(
    db: Prisma.TransactionClient,
    companyId: string,
    dto: CreateUserDto,
  ): Promise<{ id: string; email: string; status: string }> {
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

    // Use Clerk's Invitations API rather than Users.createUser. Invitations
    // actually send the email and route the invitee through Clerk's hosted
    // "complete your sign-up" + set-password flow. createUser would silently
    // mint the identity with no email at all (Sprint 7 task 7.2 fix).
    //
    // The webhook (3.4) handles the rest: when the invitee completes signup,
    // Clerk fires user.created → we look up the pre-created row by email and
    // link clerk_user_id + flip status to 'active'.
    try {
      await this.clerk.invitations.createInvitation({
        emailAddress: dto.email,
        publicMetadata: {
          // Carried into the resulting Clerk user; we don't rely on it (our
          // webhook joins by email), but it makes Clerk's dashboard easier
          // to read when triaging issues.
          qtmInvitedUserId: user.id,
        },
      });
    } catch (err) {
      this.log.warn(`Clerk createInvitation failed for ${dto.email}; rolling back local row`);
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
      const message =
        err && typeof err === 'object' && 'errors' in err
          ? JSON.stringify((err as { errors: unknown }).errors)
          : (err as Error)?.message;
      throw new BadRequestException(`Could not send invitation: ${message}`);
    }

    return { id: user.id, email: user.email, status: user.status };
  }
}
