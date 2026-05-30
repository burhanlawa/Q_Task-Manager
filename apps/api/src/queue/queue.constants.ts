// Queue names live here (not in queue.module) to dodge the circular import
// between the module (registers + schedules) and the @Processor-decorated
// workers it loads.

// Sprint 14.8: daily TTL sweep of read+expired notification rows.
export const NOTIFICATIONS_CLEANUP_QUEUE = 'notifications-cleanup';

// Sprint 17.2: monthly job to ensure the activity_log partition for
// (today + 2 months) exists. Idempotent; safe to re-run.
export const ACTIVITY_LOG_PARTITIONS_QUEUE = 'activity-log-partitions';

// Sprint 19.2: daily 09:00 UTC sweep that sends a trial-ending reminder
// three days before trial_end_at and converts expired trials to status
// 'expired' once trial_end_at has passed. Idempotent per-subscription
// via metadata flags on the trialing row.
export const TRIAL_LIFECYCLE_QUEUE = 'trial-lifecycle';

// Sprint 20.6: daily 09:30 UTC sweep that drives the past-due dunning
// ladder (warning → read-only → suspended → locked → deletion-enqueued)
// for subscriptions stuck in past_due. Day-count anchors on
// subscriptions.past_due_at, stamped by the webhook handlers.
export const PAST_DUE_LIFECYCLE_QUEUE = 'past-due-lifecycle';

// Sprint 20.6: one-shot jobs enqueued by the past-due processor when a
// tenant crosses day 120. The processor itself is gated by
// ALLOW_HARD_DELETE=true — by default it logs intent and stops short of
// the real delete, so a misconfigured prod deploy can't accidentally
// wipe a customer.
export const TENANT_DELETION_QUEUE = 'tenant-deletion';

// Sprint 20.9: one-shot jobs enqueued when an Admin requests a data
// export from /billing/export. The processor builds a ZIP, uploads to
// R2, and updates the data_exports row to status='ready' with a 7-day
// expiry. Run async because big tenants can have lots of rows; the HTTP
// request returns immediately with the export id for status polling.
export const DATA_EXPORT_QUEUE = 'data-export';
