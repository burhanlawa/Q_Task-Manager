import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUnlimitedUsers, limitsFor } from './plan-limits';

// Sprint 19.3 — Plan limit enforcement.
//
// Single source of truth for "is this tenant allowed to add another
// user / store another byte?" Lives outside users/files so both modules
// can call it without forming a circular import, and so future gates
// (broadcasts/month, custom roles, etc.) have an obvious home.
//
// All check methods throw UnprocessableEntityException with a stable
// payload shape: { message, plan, limit, used }. The web side reads
// `plan` to decide which upgrade CTA to show.
//
// Both gates resolve the company's current plan from the companies row,
// not from the subscriptions row. The companies cache is the one the
// rest of the app already trusts (admin dashboard reads it; the 19.2
// scheduler keeps it in sync with the subscriptions source-of-truth).
// Reading from one column instead of joining two tables also keeps the
// hot path cheap on uploads + invites.

@Injectable()
export class PlanLimitsService {
  /**
   * Throws if adding one more user would push the tenant past its plan's
   * seat cap. Called from UsersService.inviteToTenant BEFORE the
   * db.user.create, so a blocked invite never writes a row.
   *
   * "Active or invited" is the right count to compare against: an invited
   * user occupies a seat from the moment the invite goes out, otherwise
   * a tenant could send 50 pending invites under a 3-seat cap.
   */
  async assertCanAddUser(db: Prisma.TransactionClient, companyId: string): Promise<void> {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { plan: true },
    });
    if (!company) return; // belt-and-suspenders; controllers already 404 earlier
    const limits = limitsFor(company.plan);
    if (isUnlimitedUsers(limits.maxUsers)) return;

    const seatCount = await db.user.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['active', 'invited'] },
      },
    });
    if (seatCount >= limits.maxUsers) {
      throw new UnprocessableEntityException({
        message: `Your ${company.plan} plan is limited to ${limits.maxUsers} users. Upgrade to add more.`,
        code: 'plan_user_limit',
        plan: company.plan,
        limit: limits.maxUsers,
        used: seatCount,
      });
    }
  }

  /**
   * Throws if adding `addedBytes` would push the tenant past its plan's
   * storage cap. Called from FilesController.createUpload BEFORE the
   * presigned URL is handed back, so the user can't waste a PUT on a
   * file the server would reject server-side anyway.
   *
   * We don't sum live from the files table — `companies.storage_used_bytes`
   * is maintained by the trg_files_storage_used trigger from Sprint 11
   * and stays exact across uploads / deletes / version replacements.
   */
  async assertCanUpload(
    db: Prisma.TransactionClient,
    companyId: string,
    addedBytes: number,
  ): Promise<void> {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { plan: true, storageUsedBytes: true },
    });
    if (!company) return;
    const activeUserCount = await db.user.count({
      where: { companyId, status: 'active', deletedAt: null },
    });
    const limit = limitsFor(company.plan).storageBytes(activeUserCount);
    const prospective = company.storageUsedBytes + BigInt(addedBytes);
    if (prospective > limit) {
      throw new UnprocessableEntityException({
        message: `Upload would exceed your ${company.plan} plan's storage limit.`,
        code: 'plan_storage_limit',
        plan: company.plan,
        limit_bytes: limit.toString(),
        used_bytes: company.storageUsedBytes.toString(),
        attempted_bytes: addedBytes,
      });
    }
  }
}
