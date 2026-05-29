import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type AudienceKind = 'all_company' | 'branch' | 'role' | 'custom';

export type AudienceFilter = {
  branch_id?: string;
  role_id?: string;
  user_ids?: string[];
};

// Resolves an audience descriptor to the list of user_ids who should
// receive the broadcast in this tenant. Pure DB query — no notification
// writes happen here. Always excludes:
//   - users not in 'active' status (suspended / invited / etc. don't get blast emails)
//   - soft-deleted users
// The sender themselves IS included; broadcasts feel weird if "all-company"
// excludes the sender. The notifications writer already skips self-actor
// notifications where appropriate.

@Injectable()
export class AudienceResolverService {
  async resolve(
    db: Prisma.TransactionClient,
    companyId: string,
    audience: AudienceKind,
    filter: AudienceFilter,
  ): Promise<string[]> {
    switch (audience) {
      case 'all_company':
        return this.allCompany(db, companyId);
      case 'branch':
        if (!filter.branch_id) {
          throw new BadRequestException('audience=branch requires audience_filter.branch_id');
        }
        return this.byBranch(db, companyId, filter.branch_id);
      case 'role':
        if (!filter.role_id) {
          throw new BadRequestException('audience=role requires audience_filter.role_id');
        }
        return this.byRole(db, companyId, filter.role_id);
      case 'custom':
        if (!filter.user_ids?.length) {
          throw new BadRequestException(
            'audience=custom requires audience_filter.user_ids (non-empty array)',
          );
        }
        return this.custom(db, companyId, filter.user_ids);
      default:
        throw new BadRequestException(`Unknown audience: ${audience as string}`);
    }
  }

  private async allCompany(db: Prisma.TransactionClient, companyId: string): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { companyId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async byBranch(
    db: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
  ): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { companyId, branchId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // "Everyone with this role granted" — looks at user_roles. We don't union
  // with user_system_roles here because those are admin-y system grants
  // (CEO, Admin) that the sender probably means to address via the role
  // key anyway. If/when that distinction matters, expose a separate
  // audience kind.
  private async byRole(
    db: Prisma.TransactionClient,
    companyId: string,
    roleId: string,
  ): Promise<string[]> {
    const rows = await db.userRole.findMany({
      where: { roleId, user: { companyId, status: 'active', deletedAt: null } },
      select: { userId: true },
    });
    // Dedupe just in case a future schema allows multiple grants of the
    // same role — currently @@unique on (user_id, role_id) prevents it.
    return Array.from(new Set(rows.map((r) => r.userId)));
  }

  private async custom(
    db: Prisma.TransactionClient,
    companyId: string,
    userIds: string[],
  ): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { id: { in: userIds }, companyId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
