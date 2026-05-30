import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { TRIAL_LIFECYCLE_QUEUE } from './queue.constants';

// Sprint 19.2 — Trial lifecycle scheduler.
//
// Runs daily at 09:00 UTC. Two side effects per pass:
//
//   1. Reminder window. Any 'trialing' subscription whose trial_end_at
//      falls within the next 3 days AND that hasn't been reminded yet
//      gets a 'trial_ending_soon' in-app notification sent to every
//      CEO/Admin in the tenant. We stamp trial_reminder_sent_at so the
//      next run is a no-op for that row.
//
//   2. Conversion window. Any 'trialing' subscription whose trial_end_at
//      has already passed gets converted: status → 'expired', plan stays
//      'starter' (there is no 'free' plan in the enum — 'expired' on
//      starter is our equivalent of "Free tier" since the storage gate
//      caps unpaid usage). We also push 'trial_expired' to CEO/Admins.
//
// The day-of-cron isn't load-bearing for correctness: the windows are
// "≤ 3 days" and "< now()", so a missed firing just lands the action a
// day late. Both code paths are idempotent — the reminder via the
// timestamp column, the conversion via the status filter.
//
// Like the other workers, this connects with DATABASE_URL (owner role)
// so it crosses tenants. notifications.create() runs inside the same
// owner-role transaction; RLS on notifications USING (user_id = me) is
// bypassed there which is what we want for a system-generated row.

const REMINDER_TYPE = 'trial_ending_soon';
const EXPIRED_TYPE = 'trial_expired';

@Processor(TRIAL_LIFECYCLE_QUEUE)
export class TrialLifecycleProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger(TrialLifecycleProcessor.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async process(): Promise<{ remindersSent: number; expired: number }> {
    const now = new Date();
    const reminderCutoff = new Date(now.getTime() + 3 * 86_400_000);

    // --- Reminders ------------------------------------------------------
    // "Day 11" of a 14-day trial == trial_end - 3 days. We bracket on
    // (now, now + 3d] so the job catches rows whose end date is within
    // the next 3 days, including a missed-firing recovery window.
    const reminderRows = await this.db.subscription.findMany({
      where: {
        status: 'trialing',
        trialEndAt: { gt: now, lte: reminderCutoff },
        trialReminderSentAt: null,
      },
      select: { id: true, companyId: true, trialEndAt: true },
    });

    let remindersSent = 0;
    for (const sub of reminderRows) {
      const recipients = await this.adminRecipients(sub.companyId);
      for (const userId of recipients) {
        await this.notifications.create(this.db, {
          recipientId: userId,
          companyId: sub.companyId,
          type: REMINDER_TYPE,
          title: 'Your trial ends soon',
          message: `Your 14-day trial ends on ${sub.trialEndAt!.toISOString().slice(0, 10)}. Upgrade to keep your team's data.`,
          actionUrl: '/admin/billing',
          priority: 'high',
          metadata: { trialEndAt: sub.trialEndAt!.toISOString() },
        });
      }
      await this.db.subscription.update({
        where: { id: sub.id },
        data: { trialReminderSentAt: now },
      });
      remindersSent += recipients.length;
    }

    // --- Expirations ----------------------------------------------------
    // trial_end_at < now AND still 'trialing' → convert. We do the
    // status flip in the same statement that re-syncs the companies
    // cache; admin dashboard reads companies.status, so the two writes
    // need to land together.
    const expiredRows = await this.db.subscription.findMany({
      where: { status: 'trialing', trialEndAt: { lt: now } },
      select: { id: true, companyId: true },
    });

    let expired = 0;
    for (const sub of expiredRows) {
      await this.db.$transaction([
        this.db.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired' },
        }),
        this.db.company.update({
          where: { id: sub.companyId },
          data: { status: 'expired' },
        }),
      ]);
      const recipients = await this.adminRecipients(sub.companyId);
      for (const userId of recipients) {
        await this.notifications.create(this.db, {
          recipientId: userId,
          companyId: sub.companyId,
          type: EXPIRED_TYPE,
          title: 'Your trial has ended',
          message:
            'Your free trial has ended. The workspace is now read-only-ish (uploads + invites are blocked) until you upgrade.',
          actionUrl: '/admin/billing',
          priority: 'high',
        });
      }
      expired += 1;
    }

    this.log.log(
      `Trial lifecycle: ${remindersSent} reminder notif(s) across ${reminderRows.length} sub(s); ${expired} sub(s) expired.`,
    );
    return { remindersSent, expired };
  }

  // CEO + Admin of a tenant. We notify both because either can act on
  // billing — the org_role union mirrors the dashboard subscription card
  // visibility rule from Sprint 18.7.
  private async adminRecipients(companyId: string): Promise<string[]> {
    const users = await this.db.user.findMany({
      where: { companyId, orgRole: { in: ['ceo', 'admin'] }, status: 'active' },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
