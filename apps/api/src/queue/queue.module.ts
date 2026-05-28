import { BullModule } from '@nestjs/bullmq';
import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { NotificationsCleanupProcessor } from './notifications-cleanup.processor';
import { NOTIFICATIONS_CLEANUP_QUEUE } from './queue.constants';

export { NOTIFICATIONS_CLEANUP_QUEUE };

// Cron pattern from the spec: 03:00 every day in the server's local TZ. We
// pin the tz to UTC so dev machines in any locale schedule identically.
const CLEANUP_CRON = '0 3 * * *';
const REPEAT_JOB_KEY = 'notifications-cleanup-daily';

// Global so any future module can inject @InjectQueue(...) without re-importing.
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        // BullMQ tolerates a missing URL by failing at first job attempt; we
        // intentionally allow the API to boot without Redis so dev workflows
        // (e.g. integration tests) don't require it. The scheduler below
        // logs and bails if connection.url is empty.
        url: process.env.REDIS_URL ?? undefined,
        // BullMQ requires this on ioredis for blocking commands.
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_CLEANUP_QUEUE }),
  ],
  providers: [NotificationsCleanupProcessor],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  private readonly log = new Logger(QueueModule.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_CLEANUP_QUEUE)
    private readonly cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.log.warn('REDIS_URL not set; BullMQ cron jobs will not run. Set REDIS_URL to enable.');
      return;
    }
    // Idempotent: BullMQ deduplicates repeatable jobs by `key`, so re-running
    // this on every boot is safe. We DON'T removeRepeatable first because that
    // would create a brief window where the schedule is missing.
    await this.cleanupQueue.add(
      'run',
      {},
      {
        repeat: { pattern: CLEANUP_CRON, tz: 'UTC', key: REPEAT_JOB_KEY },
        // Job state is tiny; keep last few completed for visibility, no failures
        // hanging around forever.
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );
    this.log.log(`Scheduled notifications cleanup: '${CLEANUP_CRON}' UTC (daily at 03:00 UTC).`);
  }
}
