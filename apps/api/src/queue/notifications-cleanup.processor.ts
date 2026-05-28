import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NOTIFICATIONS_CLEANUP_QUEUE } from './queue.constants';

// Daily TTL sweep (Sprint 14.8). Deletes notifications that are BOTH:
//   - past their expires_at (90-day default from migration), AND
//   - already read (read_at IS NOT NULL — spec wrote 'is_read = TRUE' but our
//     schema uses a nullable timestamp; semantically identical).
//
// Unread-but-expired rows are intentionally kept. Users still need to see
// notifications they missed, even if the TTL window technically passed.
//
// Connects with DATABASE_URL (owner role) so the DELETE crosses all tenants
// — the worker has no request context and no `app.current_company_id`, so
// the app_user role would see zero rows under RLS and delete nothing.

@Processor(NOTIFICATIONS_CLEANUP_QUEUE)
export class NotificationsCleanupProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger(NotificationsCleanupProcessor.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async process(): Promise<{ deleted: number }> {
    const deleted = await this.db.$executeRaw`
      DELETE FROM notifications
      WHERE expires_at < now()
        AND read_at IS NOT NULL
    `;
    this.log.log(`Notifications cleanup: deleted ${deleted} expired+read row(s).`);
    return { deleted };
  }
}
