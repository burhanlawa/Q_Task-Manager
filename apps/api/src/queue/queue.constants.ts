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
