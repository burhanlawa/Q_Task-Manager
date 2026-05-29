import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// All audience kinds Sprint 16.3 needs to resolve. 'role' and 'all_company'
// stay for backwards compatibility with the 16.1 enum + 16.2 callers; new
// callers should prefer the spec-shaped 'company' / 'team' / 'department'.
export type AudienceKind =
  | 'all_company' // legacy alias for 'company'
  | 'company'
  | 'branch'
  | 'department'
  | 'team'
  | 'role'
  | 'custom';

// Per-spec storage shape: `target_ids` is the canonical key. We also accept
// the 16.2 legacy single-id keys (branch_id, role_id, user_ids) so existing
// broadcast rows still resolve cleanly.
export type AudienceFilter = {
  target_ids?: string[];
  // Legacy keys from 16.1/16.2:
  branch_id?: string;
  role_id?: string;
  user_ids?: string[];
};

@Injectable()
export class AudienceResolverService {
  // Pure DB query: (audience, filter) → user_ids[]. Excludes:
  //   - users not in 'active' status (invited/suspended don't get blast emails)
  //   - soft-deleted users
  // The sender is INCLUDED — "all-company" feels weird if the sender is missing.
  // The notifications writer skips self-actor cases on its own where relevant.
  async resolve(
    db: Prisma.TransactionClient,
    companyId: string,
    audience: AudienceKind,
    filter: AudienceFilter,
  ): Promise<string[]> {
    switch (audience) {
      case 'company':
      case 'all_company':
        return this.byCompany(db, companyId);

      case 'branch':
        return this.byBranches(db, companyId, normalizeTargetIds(filter, 'branch_id'));

      case 'department':
        return this.byDepartments(db, companyId, normalizeTargetIds(filter));

      case 'team':
        return this.byTeams(db, companyId, normalizeTargetIds(filter));

      case 'role':
        return this.byRoles(db, companyId, normalizeTargetIds(filter, 'role_id'));

      case 'custom':
        return this.byUserIds(db, companyId, normalizeTargetIds(filter, 'user_ids'));

      default:
        throw new BadRequestException(`Unknown audience: ${String(audience)}`);
    }
  }

  private async byCompany(db: Prisma.TransactionClient, companyId: string): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { companyId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async byBranches(
    db: Prisma.TransactionClient,
    companyId: string,
    branchIds: string[],
  ): Promise<string[]> {
    if (branchIds.length === 0) {
      throw new BadRequestException('audience=branch requires target_ids (at least one branch_id)');
    }
    const rows = await db.user.findMany({
      where: {
        companyId,
        branchId: { in: branchIds },
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async byDepartments(
    db: Prisma.TransactionClient,
    companyId: string,
    departmentIds: string[],
  ): Promise<string[]> {
    if (departmentIds.length === 0) {
      throw new BadRequestException(
        'audience=department requires target_ids (at least one department_id)',
      );
    }
    const rows = await db.user.findMany({
      where: {
        companyId,
        departmentId: { in: departmentIds },
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // For teams we go through user_teams (members can sit in multiple teams).
  // Dedupe at the end because a user in two targeted teams should still be
  // notified once.
  private async byTeams(
    db: Prisma.TransactionClient,
    companyId: string,
    teamIds: string[],
  ): Promise<string[]> {
    if (teamIds.length === 0) {
      throw new BadRequestException('audience=team requires target_ids (at least one team_id)');
    }
    const rows = await db.userTeam.findMany({
      where: {
        teamId: { in: teamIds },
        user: { companyId, status: 'active', deletedAt: null },
      },
      select: { userId: true },
    });
    return Array.from(new Set(rows.map((r) => r.userId)));
  }

  // Everyone with one of these roles granted. Walks user_roles (per-role
  // grants); we DON'T union user_system_roles here because system roles
  // are the elevated grants (CEO/Admin) and 'broadcast to all admins'
  // feels like a separate, narrower intent.
  private async byRoles(
    db: Prisma.TransactionClient,
    companyId: string,
    roleIds: string[],
  ): Promise<string[]> {
    if (roleIds.length === 0) {
      throw new BadRequestException('audience=role requires target_ids (at least one role_id)');
    }
    const rows = await db.userRole.findMany({
      where: {
        roleId: { in: roleIds },
        user: { companyId, status: 'active', deletedAt: null },
      },
      select: { userId: true },
    });
    return Array.from(new Set(rows.map((r) => r.userId)));
  }

  private async byUserIds(
    db: Prisma.TransactionClient,
    companyId: string,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) {
      throw new BadRequestException('audience=custom requires target_ids (at least one user_id)');
    }
    const rows = await db.user.findMany({
      where: {
        id: { in: userIds },
        companyId,
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

// Accept both the spec shape (`target_ids: string[]`) and the 16.2 legacy
// keys. The legacy key (branch_id / role_id / user_ids) is the fallback so
// existing broadcast rows still resolve when re-read by a future endpoint.
function normalizeTargetIds(
  filter: AudienceFilter,
  legacyKey?: 'branch_id' | 'role_id' | 'user_ids',
): string[] {
  if (filter.target_ids?.length) return filter.target_ids;
  if (!legacyKey) return [];
  if (legacyKey === 'user_ids') return filter.user_ids ?? [];
  const v = filter[legacyKey];
  return typeof v === 'string' && v ? [v] : [];
}
