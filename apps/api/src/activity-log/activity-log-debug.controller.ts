import { InjectQueue } from '@nestjs/bullmq';
import { Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ACTIVITY_LOG_PARTITIONS_QUEUE } from '../queue/queue.constants';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';

// Small debug surface for the partition cron. The real scheduler runs on
// the 1st of every month at 02:00 UTC; this endpoint lets the 17.2
// done-check fire it on demand and confirm a new partition appears.
//
// Auth-gated by the standard Clerk guard so a random external caller can't
// trigger DDL. Same pattern as POST /notifications/debug-run-cleanup.
@Controller('activity-log')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class ActivityLogDebugController {
  constructor(@InjectQueue(ACTIVITY_LOG_PARTITIONS_QUEUE) private readonly queue: Queue) {}

  @Post('debug-create-next-partition')
  @HttpCode(200)
  async run(): Promise<{ created: boolean; partitionName: string }> {
    const job = await this.queue.add('run', {}, { removeOnComplete: { age: 60 } });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = await job.getState();
      if (state === 'completed') {
        return job.returnvalue as { created: boolean; partitionName: string };
      }
      if (state === 'failed') {
        throw new Error(`partition job failed: ${job.failedReason ?? 'unknown'}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('partition job timed out after 30s');
  }
}
