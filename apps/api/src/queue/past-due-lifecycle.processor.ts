import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import { PAST_DUE_LIFECYCLE_QUEUE, TENANT_DELETION_QUEUE } from './queue.constants';

// Sprint 20.6 — Past-due lifecycle scheduler.
//
// Daily at 09:30 UTC. Anchors on subscriptions.past_due_at (set by the
// Paddle 19.6 / Stripe 20.3 webhook handlers when status flips to
// past_due). Each row's age in days drives a forward state machine —
// once a row reaches a band, it stays there (or advances further) but
// never reverts. Recovery (status flipping back to active) is handled
// by the webhook handlers; this scheduler only advances the ladder.
//
// Bands per blueprint §3.2:
//   day 1–7   → warning notification (status stays past_due)
//   day 7–14  → companies.read_only_at set (Sprint 20.7 gates writes)
//   day 14–30 → status → 'paused'
//   day 30–120→ status → 'expired'
//   day >= 120→ enqueue tenant-deletion job
//
// Idempotency comes from the flag columns:
//   past_due_warning_sent_at  → block re-sending the day-1 warning
//   companies.read_only_at    → already set means we've crossed day-7
//   subscriptions.status      → 'paused' / 'expired' won't be re-set
//   deletion_enqueued_at      → block re-enqueueing past day-120
//
// The day_120 enqueue is the most destructive step in the codebase.
// We deliberately split it from the actual delete: this processor only
// schedules; the tenant-deletion processor needs ALLOW_HARD_DELETE=true
// to do real work. See tenant-deletion.processor.ts.

const PAST_DUE_WARNING_TYPE = 'past_due_warning';
const READ_ONLY_TYPE = 'past_due_read_only';
const SUSPENDED_TYPE = 'past_due_suspended';
const LOCKED_TYPE = 'past_due_locked';

const DAY_MS = 86_400_000;

@Processor(PAST_DUE_LIFECYCLE_QUEUE)
export class PastDueLifecycleProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger(PastDueLifecycleProcessor.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  constructor(
    private readonly notifications: NotificationsService,
    @InjectQueue(TENANT_DELETION_QUEUE) private readonly deletionQueue: Queue,
  ) {
    super();
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async process(): Promise<{
    warnedToday: number;
    readOnly: number;
    suspended: number;
    locked: number;
    deletionEnqueued: number;
  }> {
    const now = new Date();

    // Pull every row with past_due_at set. We don't filter by status
    // because once advanced (paused / expired) the row's status is no
    // longer past_due, but past_due_at stays set as the ladder anchor.
    // Recovery clears past_due_at (webhook handlers), which is what
    // removes a row from this query.
    const rows = await this.db.subscription.findMany({
      where: { pastDueAt: { not: null } },
      select: {
        id: true,
        companyId: true,
        status: true,
        pastDueAt: true,
        pastDueWarningSentAt: true,
        deletionEnqueuedAt: true,
      },
    });

    let warnedToday = 0;
    let readOnly = 0;
    let suspended = 0;
    let locked = 0;
    let deletionEnqueued = 0;

    for (const row of rows) {
      if (!row.pastDueAt) continue; // type-narrow; the filter guarantees this
      const daysPastDue = Math.floor((now.getTime() - row.pastDueAt.getTime()) / DAY_MS);

      // --- Day 1–7: warning ---------------------------------------
      if (daysPastDue >= 1 && row.pastDueWarningSentAt === null) {
        await this.sendBandNotification(row.companyId, PAST_DUE_WARNING_TYPE, daysPastDue);
        await this.db.subscription.update({
          where: { id: row.id },
          data: { pastDueWarningSentAt: now },
        });
        warnedToday += 1;
      }

      // --- Day 7+: read-only flag -------------------------------
      // We only set this once. The check guards against re-stamping
      // and against late-arrival recovery clearing it mid-day.
      if (daysPastDue >= 7) {
        const company = await this.db.company.findUnique({
          where: { id: row.companyId },
          select: { readOnlyAt: true },
        });
        if (company && company.readOnlyAt === null) {
          await this.db.company.update({
            where: { id: row.companyId },
            data: { readOnlyAt: now },
          });
          await this.sendBandNotification(row.companyId, READ_ONLY_TYPE, daysPastDue);
          readOnly += 1;
        }
      }

      // --- Day 14+: suspended -------------------------------------
      if (daysPastDue >= 14 && row.status !== 'paused' && row.status !== 'expired') {
        await this.db.$transaction([
          this.db.subscription.update({ where: { id: row.id }, data: { status: 'paused' } }),
          this.db.company.update({
            where: { id: row.companyId },
            data: { status: 'paused' },
          }),
        ]);
        await this.sendBandNotification(row.companyId, SUSPENDED_TYPE, daysPastDue);
        suspended += 1;
      }

      // --- Day 30+: locked ----------------------------------------
      if (daysPastDue >= 30 && row.status !== 'expired') {
        await this.db.$transaction([
          this.db.subscription.update({ where: { id: row.id }, data: { status: 'expired' } }),
          this.db.company.update({
            where: { id: row.companyId },
            data: { status: 'expired' },
          }),
        ]);
        await this.sendBandNotification(row.companyId, LOCKED_TYPE, daysPastDue);
        locked += 1;
      }

      // --- Day 120+: enqueue deletion -----------------------------
      // We DON'T delete here. We enqueue a one-shot job whose
      // processor decides whether the operator actually wants to
      // wipe the tenant. The deletion_enqueued_at flag prevents
      // double-enqueue on subsequent days.
      if (daysPastDue >= 120 && row.deletionEnqueuedAt === null) {
        await this.deletionQueue.add(
          'delete-tenant',
          { companyId: row.companyId, subscriptionId: row.id, queuedAt: now.toISOString() },
          {
            // No retries — the deletion processor is itself idempotent
            // and we don't want a transient error to trigger a
            // re-attempt against a half-deleted tenant.
            attempts: 1,
            removeOnComplete: { age: (30 * DAY_MS) / 1000, count: 200 },
            removeOnFail: { age: (90 * DAY_MS) / 1000, count: 200 },
          },
        );
        await this.db.subscription.update({
          where: { id: row.id },
          data: { deletionEnqueuedAt: now },
        });
        this.log.warn(
          `past_due day=${daysPastDue}: enqueued tenant-deletion for company=${row.companyId}. ` +
            `Real delete requires ALLOW_HARD_DELETE=true on the worker process.`,
        );
        deletionEnqueued += 1;
      }
    }

    this.log.log(
      `past_due lifecycle: scanned ${rows.length}; warned=${warnedToday} readOnly=${readOnly} suspended=${suspended} locked=${locked} deletionEnqueued=${deletionEnqueued}`,
    );
    return { warnedToday, readOnly, suspended, locked, deletionEnqueued };
  }

  // Notify every CEO/Admin of the tenant. Same recipient pattern as
  // the Sprint 19.2 trial scheduler; the notifications service handles
  // in-app + (when wired) email.
  private async sendBandNotification(
    companyId: string,
    type: string,
    daysPastDue: number,
  ): Promise<void> {
    const recipients = await this.db.user.findMany({
      where: { companyId, orgRole: { in: ['ceo', 'admin'] }, status: 'active' },
      select: { id: true },
    });
    for (const u of recipients) {
      await this.notifications.create(this.db, {
        recipientId: u.id,
        companyId,
        type,
        title: this.titleFor(type),
        message: this.messageFor(type, daysPastDue),
        actionUrl: '/billing',
        priority: 'high',
        metadata: { daysPastDue },
      });
    }
  }

  private titleFor(type: string): string {
    switch (type) {
      case PAST_DUE_WARNING_TYPE:
        return 'Payment failed — please update your billing';
      case READ_ONLY_TYPE:
        return 'Workspace is now read-only';
      case SUSPENDED_TYPE:
        return 'Subscription suspended';
      case LOCKED_TYPE:
        return 'Subscription locked';
      default:
        return 'Billing update';
    }
  }

  private messageFor(type: string, daysPastDue: number): string {
    switch (type) {
      case PAST_DUE_WARNING_TYPE:
        return `Your last payment failed. Update your card or pay by bank transfer to keep your team's data. (${daysPastDue} day(s) past due)`;
      case READ_ONLY_TYPE:
        return `Your workspace is now read-only after ${daysPastDue} days. You can still read everything but new writes are blocked until billing is resolved.`;
      case SUSPENDED_TYPE:
        return `Your subscription has been suspended after ${daysPastDue} days. Sign in to /billing to recover.`;
      case LOCKED_TYPE:
        return `Your workspace is locked after ${daysPastDue} days. The workspace will be deleted at day 120 unless recovered.`;
      default:
        return `Billing update (day ${daysPastDue}).`;
    }
  }
}
