import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

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
      (prefsRows[0]?.preferences as Record<string, { in_app?: boolean } | undefined>) ?? {};
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
    return { id };
  }
}
