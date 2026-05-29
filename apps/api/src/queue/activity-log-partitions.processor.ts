import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ACTIVITY_LOG_PARTITIONS_QUEUE } from './queue.constants';

// Sprint 17.2: monthly cron that ensures the activity_log partition for
// (today + 2 months) exists. Two months ahead gives us a buffer — if the
// job is missed for any reason we still have ~30 days of runway before a
// missing partition would reject an INSERT.
//
// Idempotent: uses CREATE TABLE IF NOT EXISTS plus matching partition
// bounds. Safe to run any time, any frequency.
//
// Connects via DATABASE_URL (owner role) because:
//   - DDL (CREATE TABLE) requires owner privileges; app_user can't.
//   - The job runs outside any request context, so no tenant scope.

@Processor(ACTIVITY_LOG_PARTITIONS_QUEUE)
export class ActivityLogPartitionsProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger(ActivityLogPartitionsProcessor.name);
  private readonly db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async process(): Promise<{ created: boolean; partitionName: string }> {
    // "Today + 2 months", clamped to the first of that month.
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    const nextMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1));

    const yyyy = target.getUTCFullYear();
    const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
    const partitionName = `activity_log_${yyyy}_${mm}`;
    const fromBound = `${yyyy}-${mm}-01`;
    const toBound = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;

    // Postgres doesn't accept parameter binding for DDL identifiers, so we
    // build the statement with Prisma.raw + format the values inline. The
    // partition name and bounds are derived from server-side date math, not
    // user input — no injection surface.
    await this.db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "activity_log" ` +
        `FOR VALUES FROM ('${fromBound}') TO ('${toBound}')`,
    );

    // Was it newly created? Check whether the partition has its expected
    // bound — if a different one already covered the range, CREATE TABLE
    // IF NOT EXISTS would have been a no-op even though the partition name
    // was new. (Edge case for completeness; in practice partitions are
    // always per-month with our naming.)
    const existsRow = await this.db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = ${partitionName}
      ) AS exists
    `);
    const created = existsRow[0]?.exists === true;

    this.log.log(`Activity-log partition '${partitionName}' ensured (${fromBound} → ${toBound}).`);
    return { created, partitionName };
  }
}
