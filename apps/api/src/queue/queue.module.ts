import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ActivityLogPartitionsProcessor } from './activity-log-partitions.processor';
import { NotificationsCleanupProcessor } from './notifications-cleanup.processor';
import {
  ACTIVITY_LOG_PARTITIONS_QUEUE,
  NOTIFICATIONS_CLEANUP_QUEUE,
  TRIAL_LIFECYCLE_QUEUE,
} from './queue.constants';
import { TrialLifecycleProcessor } from './trial-lifecycle.processor';

export { NOTIFICATIONS_CLEANUP_QUEUE, ACTIVITY_LOG_PARTITIONS_QUEUE, TRIAL_LIFECYCLE_QUEUE };

// 03:00 UTC daily — TTL sweep of expired-and-read notification rows.
const CLEANUP_CRON = '0 3 * * *';
const CLEANUP_REPEAT_KEY = 'notifications-cleanup-daily';

// 02:00 UTC on the 1st of every month — ensure the activity_log partition
// for (today + 2 months) exists. Two months of runway means a missed
// firing (Redis outage, deploy gap) still leaves ~30 days of buffer before
// any INSERT could land outside an existing partition.
const PARTITION_CRON = '0 2 1 * *';
const PARTITION_REPEAT_KEY = 'activity-log-partitions-monthly';

// 09:00 UTC daily — trial lifecycle. Sends a 'trial_ending_soon' reminder
// at trial_end - 3 days and converts expired trials to status='expired'
// once trial_end_at has passed. See trial-lifecycle.processor.ts.
const TRIAL_LIFECYCLE_CRON = '0 9 * * *';
const TRIAL_LIFECYCLE_REPEAT_KEY = 'trial-lifecycle-daily';

// Global so any feature module can @InjectQueue(...) without re-importing.
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        // Boot tolerantly: if REDIS_URL is unset the API still starts; cron
        // jobs just don't get scheduled. Integration tests rely on this.
        url: process.env.REDIS_URL ?? undefined,
        // BullMQ requires this on ioredis for blocking commands.
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_CLEANUP_QUEUE }),
    BullModule.registerQueue({ name: ACTIVITY_LOG_PARTITIONS_QUEUE }),
    BullModule.registerQueue({ name: TRIAL_LIFECYCLE_QUEUE }),
  ],
  providers: [
    NotificationsCleanupProcessor,
    ActivityLogPartitionsProcessor,
    TrialLifecycleProcessor,
  ],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  private readonly log = new Logger(QueueModule.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_CLEANUP_QUEUE)
    private readonly cleanupQueue: Queue,
    @InjectQueue(ACTIVITY_LOG_PARTITIONS_QUEUE)
    private readonly partitionsQueue: Queue,
    @InjectQueue(TRIAL_LIFECYCLE_QUEUE)
    private readonly trialLifecycleQueue: Queue,
  ) {}

  async onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.log.warn('REDIS_URL not set; BullMQ cron jobs will not run. Set REDIS_URL to enable.');
      return;
    }

    // Both schedules are idempotent — BullMQ deduplicates repeatable jobs by
    // `key`, so re-running on every boot is safe and never creates a window
    // where the schedule is missing (we don't removeRepeatable first).
    await this.cleanupQueue.add(
      'run',
      {},
      {
        repeat: { pattern: CLEANUP_CRON, tz: 'UTC', key: CLEANUP_REPEAT_KEY },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );
    this.log.log(`Scheduled notifications cleanup: '${CLEANUP_CRON}' UTC (daily at 03:00 UTC).`);

    await this.partitionsQueue.add(
      'run',
      {},
      {
        repeat: { pattern: PARTITION_CRON, tz: 'UTC', key: PARTITION_REPEAT_KEY },
        removeOnComplete: { count: 12 },
        removeOnFail: { count: 50 },
      },
    );
    this.log.log(
      `Scheduled activity-log partition rollover: '${PARTITION_CRON}' UTC (1st of month, 02:00 UTC).`,
    );

    await this.trialLifecycleQueue.add(
      'run',
      {},
      {
        repeat: { pattern: TRIAL_LIFECYCLE_CRON, tz: 'UTC', key: TRIAL_LIFECYCLE_REPEAT_KEY },
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 50 },
      },
    );
    this.log.log(`Scheduled trial lifecycle: '${TRIAL_LIFECYCLE_CRON}' UTC (daily at 09:00 UTC).`);
  }
}
