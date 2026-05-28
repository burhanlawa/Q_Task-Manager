// Single named queue for the daily TTL sweep of read+expired notification
// rows (Sprint 14.8). Lives in its own file to avoid the circular import
// between queue.module (registers + schedules) and the processor (decorated
// with @Processor(name) at module-load time).
export const NOTIFICATIONS_CLEANUP_QUEUE = 'notifications-cleanup';
