import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const names = ['idx_tasks_company_status', 'idx_notifications_user_unread'];
const r = await db.$queryRawUnsafe(
  `SELECT indexname, indexdef FROM pg_indexes WHERE indexname = ANY($1::text[])`,
  names,
);
for (const row of r) console.log(`${row.indexname}\n  ${row.indexdef}\n`);
await db.$disconnect();
