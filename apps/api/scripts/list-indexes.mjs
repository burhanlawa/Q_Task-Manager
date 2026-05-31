import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const tables = ['tasks', 'notifications', 'users'];
for (const t of tables) {
  const rows = await db.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = '${t}' ORDER BY indexname`,
  );
  console.log(`=== ${t} ===`);
  for (const r of rows) console.log('  ' + r.indexname);
}
await db.$disconnect();
