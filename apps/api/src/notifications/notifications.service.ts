import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { EMAIL_SEND_QUEUE, type EmailSendJob } from '../emails/email.constants';
import { EmailTemplateService } from '../emails/templates/render';
import type { EmailableType, Locale } from '../emails/templates/types';
import { PusherService } from '../pusher/pusher.service';

// Notification types we have email templates for. Mirrors templates/types.ts;
// kept local so adding a new type without a template doesn't accidentally
// produce a render error. Cast at the boundary, validate at runtime.
const EMAILABLE_TYPES: ReadonlySet<string> = new Set<EmailableType>([
  'task_assigned',
  'task_submitted',
  'task_approved',
  'task_revision_requested',
  'task_cancelled',
  'task_reassignment_requested',
  'comment_mentioned',
  'comment_created',
  'deadline_approaching',
  'overdue',
  'onboarding_approval',
  'new_employee',
  'leave_reminder',
]);

const SUPPORTED_LOCALES: ReadonlySet<string> = new Set<Locale>(['en', 'ar', 'ckb']);

// Spec-shaped input. The service maps these onto our column names so the
// schema stays the canonical reference and callers use the names from the
// blueprint without thinking about it.
export type NotificationCreateInput = {
  /// Required. The user who should see this notification (notifications.user_id).
  recipientId: string;
  /// Required. Tenant scope. Always equal to the recipient's company_id.
  companyId: string;
  /// Short event token ('task_assigned', 'comment_mentioned', etc.). Drives
  /// localized rendering on the client and per-type channel routing.
  type: string;
  title?: string | null;
  /// Spec field 'message' → column 'body'.
  message?: string | null;
  /// Spec fields → 'source_target_*'. The polymorphic owner of the event.
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /// Optional priority — stored in metadata.priority since the column shape
  /// doesn't carry one. Recognized values: 'low' | 'normal' | 'high'.
  priority?: 'low' | 'normal' | 'high';
  /// Spec field 'action_url' → column 'link' (path, no host).
  actionUrl?: string | null;
  /// The user who triggered the event. NULL for system-generated.
  actorUserId?: string | null;
  /// Extra free-form data the UI renderer can read. Merged with priority.
  metadata?: Record<string, unknown>;
  /// Override the default 90-day TTL. NULL → use the column DEFAULT.
  expiresAt?: Date | null;
};

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly pusher: PusherService,
    private readonly templates: EmailTemplateService,
    @InjectQueue(EMAIL_SEND_QUEUE) private readonly emailQueue: Queue,
  ) {}

  /**
   * Create a notification for one recipient.
   *
   * Channel routing: reads user_notification_preferences. The prefs blob
   * has shape { "<type>": { "in_app": bool, ... } }. Anything other than
   * an explicit `in_app: false` is treated as opted-in (permissive default
   * so a brand-new tenant doesn't lose notifications until users configure).
   *
   * If the user is opted out, returns null without writing a row.
   *
   * Caller MUST pass a Prisma transaction client so the notification
   * lands atomically with the triggering action (e.g., the comment that
   * mentioned the user is inserted and the notification row arrive
   * together — a partial state is impossible).
   */
  async create(
    db: Prisma.TransactionClient,
    input: NotificationCreateInput,
  ): Promise<{ id: string } | null> {
    // 1. Channel routing — look up the recipient's preferences.
    // RLS on user_notification_preferences scopes to the calling user, so
    // we use a raw query that bypasses the RLS recipient check (we may be
    // writing a notification for someone else). The companyId guard keeps
    // the lookup tenant-safe.
    const prefsRows = await db.$queryRaw<Array<{ preferences: unknown }>>`
      SELECT preferences FROM user_notification_preferences
      WHERE user_id = ${input.recipientId}::uuid
        AND company_id = ${input.companyId}::uuid
      LIMIT 1
    `;
    const prefs =
      (prefsRows[0]?.preferences as Record<
        string,
        { in_app?: boolean; email?: boolean } | undefined
      >) ?? {};
    const inAppPref = prefs[input.type]?.in_app;
    if (inAppPref === false) {
      this.log.debug(
        `Skipping notification: user ${input.recipientId} opted out of '${input.type}'`,
      );
      return null;
    }

    // 2. Build the merged metadata blob. Priority lives here since the
    //    column shape doesn't carry one.
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.priority) metadata.priority = input.priority;

    // 3. Insert via raw SQL. We use raw INSERT (no RETURNING) because RLS
    //    on notifications scopes SELECT to "rows whose user_id = me." On
    //    a typical create.create() call Prisma adds RETURNING * which then
    //    fails the USING clause when the actor differs from the recipient
    //    (the dispatch path's whole purpose). Generating the id client-side
    //    avoids needing to read back, and the row is still visible to its
    //    actual recipient on subsequent reads.
    const id = randomUUID();
    const expiresAtSql = input.expiresAt
      ? Prisma.sql`${input.expiresAt}::timestamptz`
      : Prisma.sql`(now() + interval '90 days')`;
    await db.$executeRaw`
      INSERT INTO notifications (
        id, company_id, user_id, type, title, body, link,
        source_actor_user_id, source_target_type, source_target_id,
        metadata, expires_at
      ) VALUES (
        ${id}::uuid,
        ${input.companyId}::uuid,
        ${input.recipientId}::uuid,
        ${input.type},
        ${input.title ?? null},
        ${input.message ?? null},
        ${input.actionUrl ?? null},
        ${input.actorUserId ?? null}::uuid,
        ${input.relatedEntityType ?? null},
        ${input.relatedEntityId ?? null}::uuid,
        ${JSON.stringify(metadata)}::jsonb,
        ${expiresAtSql}
      )
    `;

    // 4. Real-time fan-out (Sprint 14.6). Fire-and-forget — the row is already
    //    durable in Postgres; Pusher is a UX accelerator, not the source of
    //    truth. We DON'T await this on the request critical path; instead we
    //    schedule it after the current microtask so a slow Pusher trigger
    //    can't bottleneck the response.
    void this.pusher.safeTrigger(`private-user-${input.recipientId}`, 'notification', {
      id,
      type: input.type,
      title: input.title ?? null,
      body: input.message ?? null,
      link: input.actionUrl ?? null,
      source_target_type: input.relatedEntityType ?? null,
      source_target_id: input.relatedEntityId ?? null,
      created_at: new Date().toISOString(),
    });

    // 5. Email fan-out (Sprint 15.4). Gated on:
    //    - prefs[type].email !== false  (permissive default, same as in_app)
    //    - we have a template for this type
    //    The DB lookups (recipient email + locale, actor name) happen INSIDE
    //    the caller's transaction so we don't race a commit; the BullMQ
    //    enqueue + render happen after, fire-and-forget so a slow Redis
    //    can't block the user's request.
    const emailPref = prefs[input.type]?.email;
    if (emailPref !== false && EMAILABLE_TYPES.has(input.type)) {
      const [recipient, actor] = await Promise.all([
        db.user.findUnique({
          where: { id: input.recipientId },
          select: { email: true, displayName: true, firstName: true, locale: true },
        }),
        input.actorUserId
          ? db.user.findUnique({
              where: { id: input.actorUserId },
              select: { displayName: true, firstName: true },
            })
          : Promise.resolve(null),
      ]);
      if (recipient?.email) {
        void this.enqueueEmail(input, id, recipient, actor).catch((err) => {
          this.log.warn(
            `Failed to enqueue email for notification ${id}: ${(err as Error).message}`,
          );
        });
      } else {
        this.log.debug(`No email on file for user ${input.recipientId}; skipping email send`);
      }
    }

    return { id };
  }

  private async enqueueEmail(
    input: NotificationCreateInput,
    notificationId: string,
    recipient: {
      email: string | null;
      displayName: string | null;
      firstName: string | null;
      locale: string | null;
    },
    actor: { displayName: string | null; firstName: string | null } | null,
  ): Promise<void> {
    // Build template vars from the input + metadata. Templates use
    // {recipientName}, {actorName}, {taskTitle}, {dueDate}, {companyName},
    // {newUserName}, {leaveDate} — pull whichever the caller supplied
    // through metadata; fall back to the notification title for taskTitle
    // so the email is never empty.
    const meta = (input.metadata ?? {}) as Record<string, unknown>;
    const vars: Record<string, string> = {
      recipientName: recipient.firstName ?? recipient.displayName ?? '',
      actorName: actor?.displayName ?? actor?.firstName ?? 'Someone',
      taskTitle: stringOr(meta.taskTitle, input.title ?? ''),
      dueDate: stringOr(meta.dueDate, ''),
      companyName: stringOr(meta.companyName, ''),
      newUserName: stringOr(meta.newUserName, ''),
      leaveDate: stringOr(meta.leaveDate, ''),
    };

    const locale: Locale = SUPPORTED_LOCALES.has(recipient.locale ?? '')
      ? (recipient.locale as Locale)
      : 'en';
    const rendered = this.templates.render(input.type as EmailableType, locale, vars);

    const payload: EmailSendJob = {
      to: recipient.email!,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // Idempotency key = notification id so a BullMQ retry can't cause
      // Resend to send the same email twice within their 24h dedupe window.
      idempotencyKey: notificationId,
      tags: { type: input.type, locale },
    };
    await this.emailQueue.add('send', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400, count: 200 },
    });
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
