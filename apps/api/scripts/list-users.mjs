import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const users = await db.user.findMany({
  where: { deletedAt: null },
  select: { id: true, email: true, orgRole: true, companyId: true, status: true },
  orderBy: { createdAt: 'asc' },
});
for (const u of users) console.log(JSON.stringify(u));
await db.$disconnect();
