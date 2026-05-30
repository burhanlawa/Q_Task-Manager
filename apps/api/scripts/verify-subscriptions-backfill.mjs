import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const [companies, subs, mismatched] = await Promise.all([
  db.company.count(),
  db.subscription.count(),
  db.$queryRawUnsafe(
    `SELECT c.id, c.name FROM companies c LEFT JOIN subscriptions s ON s.company_id = c.id WHERE s.id IS NULL`,
  ),
]);
console.log(`companies: ${companies}`);
console.log(`subscriptions: ${subs}`);
console.log(`companies without subscription: ${mismatched.length}`);
const sample = await db.subscription.findMany({
  take: 5,
  select: { companyId: true, plan: true, status: true, billingCycle: true, paymentProvider: true },
});
console.log('sample rows:');
for (const s of sample) console.log(' ', JSON.stringify(s));
await db.$disconnect();
