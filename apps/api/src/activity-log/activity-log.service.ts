import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type SensitiveReadParams = {
  /** Prisma transaction client from the tenant interceptor — already RLS-scoped. */
  db: Prisma.TransactionClient;
  /** Tenant company UUID. */
  companyId: string;
  /** UUID of the user doing the read. */
  actorUserId: string;
  /** UUID of the user whose sensitive field is being read. */
  targetUserId: string;
  /** Column name(s) — e.g. 'date_of_birth' or 'national_id'. */
  fields: string[];
};

@Injectable()
export class ActivityLogService {
  /**
   * Records that an actor read one or more sensitive fields off a target user.
   * One row per field so queries like "who looked at X's DOB?" are simple.
   *
   * Runs inside the caller's existing Prisma transaction so the log row(s) are
   * atomic with the read. If the controller throws after this, the audit row
   * is rolled back too — that's intentional: a failed request shouldn't show
   * up as a successful access.
   */
  async recordSensitiveRead(p: SensitiveReadParams): Promise<void> {
    if (p.fields.length === 0) return;
    await p.db.activityLog.createMany({
      data: p.fields.map((f) => ({
        companyId: p.companyId,
        actorUserId: p.actorUserId,
        actionType: 'read_sensitive_field',
        targetType: 'user',
        targetId: p.targetUserId,
        fieldChanged: f,
      })),
    });
  }

  /**
   * Records a change to a role's permissions array (Sprint 6 task 6.6).
   * Skips when before/after are equivalent so a no-op PATCH doesn't pollute
   * the audit log. Atomic with the role update because both ride the same
   * per-request transaction.
   */
  async recordRolePermissionsChange(p: {
    db: Prisma.TransactionClient;
    companyId: string;
    actorUserId: string;
    roleId: string;
    before: string[];
    after: string[];
  }): Promise<void> {
    const beforeSet = new Set(p.before);
    const afterSet = new Set(p.after);
    const added = [...afterSet].filter((k) => !beforeSet.has(k)).sort();
    const removed = [...beforeSet].filter((k) => !afterSet.has(k)).sort();
    if (added.length === 0 && removed.length === 0) return;
    await p.db.activityLog.create({
      data: {
        companyId: p.companyId,
        actorUserId: p.actorUserId,
        actionType: 'role_permissions_changed',
        targetType: 'role',
        targetId: p.roleId,
        fieldChanged: 'permissions',
        metadata: {
          before: [...p.before].sort(),
          after: [...p.after].sort(),
          added,
          removed,
        },
      },
    });
  }
}
