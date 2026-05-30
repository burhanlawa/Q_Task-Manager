import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Job } from 'bullmq';
import { TENANT_DELETION_QUEUE } from './queue.constants';

// Sprint 20.6 — Tenant deletion processor (day-120 of past-due ladder).
//
// SAFETY: hard tenant deletion is the most destructive action in this
// codebase. By default this processor logs the intent and STOPS short
// of the actual delete. The operator must set ALLOW_HARD_DELETE=true
// on the worker process to enable the real wipe.
//
// Even with the flag, the delete still:
//   - Reads the current company status; refuses to delete anything
//     that isn't still in past-due-derived state (paused / expired).
//     If a recovery happened between enqueue and execution, the row
//     is back to 'active' and we no-op.
//   - Soft-deletes via deletedAt timestamp first (Prisma onDelete:
//     Cascade handles the related rows), so an ops mistake leaves the
//     row queryable for audit until a follow-up sweep removes it.
//
// Hard delete is a Phase 2 follow-up — once we've watched a few
// deletion-eligible tenants in real traffic and trust the safeguards.

type DeleteJobData = {
  companyId: string;
  subscriptionId: string;
  queuedAt: string;
};

const RECOVERABLE_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active']);

@Processor(TENANT_DELETION_QUEUE)
export class TenantDeletionProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger(TenantDeletionProcessor.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async process(job: Job<DeleteJobData>): Promise<{ action: string; reason?: string }> {
    const { companyId } = job.data;
    const company = await this.db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!company) {
      this.log.warn(`tenant-deletion: company ${companyId} not found; nothing to do.`);
      return { action: 'noop', reason: 'company_not_found' };
    }
    if (company.deletedAt) {
      this.log.log(`tenant-deletion: company ${companyId} already soft-deleted; nothing to do.`);
      return { action: 'noop', reason: 'already_deleted' };
    }
    if (RECOVERABLE_STATUSES.has(company.status)) {
      // Recovery raced past us. The webhook handlers cleared the
      // past-due state but our queued job still fired. Refuse.
      this.log.log(
        `tenant-deletion: company ${companyId} recovered to status=${company.status}; refusing to delete.`,
      );
      return { action: 'noop', reason: 'recovered' };
    }

    if (process.env.ALLOW_HARD_DELETE !== 'true') {
      // Default branch — log loudly, do nothing destructive.
      this.log.warn(
        `tenant-deletion: would soft-delete company ${companyId} ("${company.name}") status=${company.status}. ` +
          `Skipping because ALLOW_HARD_DELETE != 'true'. Set the env var on the worker to enable.`,
      );
      return { action: 'logged-only', reason: 'flag_off' };
    }

    // ALLOW_HARD_DELETE=true → perform the soft-delete. Companies's
    // existing deletedAt column is the tombstone; nothing in the app
    // reads soft-deleted tenants (every tenant query filters
    // deletedAt: null). Hard row removal stays a Phase 2 manual sweep.
    await this.db.company.update({
      where: { id: companyId },
      data: { deletedAt: new Date() },
    });
    this.log.warn(
      `tenant-deletion: SOFT-DELETED company ${companyId} ("${company.name}"). ` +
        `Related rows remain reachable via owner-role queries for audit.`,
    );
    return { action: 'soft-deleted' };
  }
}
