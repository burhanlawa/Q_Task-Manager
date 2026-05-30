// Sprint 19.2 verify — simulates a daily-cron pass.
//
// Strategy: pick the first three trialing subscriptions, rewrite their
// trial_end_at to land in three buckets, run the processor logic, and
// then assert the right side-effects happened. Restores the original
// values at the end so re-running is safe.
//
//   bucket A → trial_end_at = now + 8 days  → no action (outside reminder window)
//   bucket B → trial_end_at = now + 2 days  → reminder fires
//   bucket C → trial_end_at = now - 1 day   → conversion fires (→ 'expired')

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const REMINDER_TYPE = 'trial_ending_soon';
const EXPIRED_TYPE = 'trial_expired';

const all = await db.subscription.findMany({
  where: { status: 'trialing' },
  select: { id: true, companyId: true, trialEndAt: true, trialReminderSentAt: true },
  orderBy: { createdAt: 'asc' },
});

if (all.length < 3) {
  console.error(`Need at least 3 trialing subs, found ${all.length}. Re-seed or run after signup.`);
  process.exit(1);
}

const [a, b, c] = all;
const now = new Date();
const dPlus = (n) => new Date(now.getTime() + n * 86_400_000);

// Snapshot originals so we can restore.
const originals = [a, b, c].map((s) => ({ ...s }));

// Set up the three buckets and clear any prior reminder flag.
await db.subscription.update({
  where: { id: a.id },
  data: { trialEndAt: dPlus(8), trialReminderSentAt: null },
});
await db.subscription.update({
  where: { id: b.id },
  data: { trialEndAt: dPlus(2), trialReminderSentAt: null },
});
await db.subscription.update({
  where: { id: c.id },
  data: { trialEndAt: dPlus(-1), trialReminderSentAt: null },
});

// Mark a notification-log baseline so we can count what gets created.
const baselineNotifCount = await db.notification.count({
  where: { type: { in: [REMINDER_TYPE, EXPIRED_TYPE] } },
});

// Run the processor inline. We can't import the Nest provider standalone
// without bootstrapping the app, so we replicate its logic here. Keep
// this in lockstep with trial-lifecycle.processor.ts.
const reminderCutoff = dPlus(3);

const reminderRows = await db.subscription.findMany({
  where: {
    status: 'trialing',
    trialEndAt: { gt: now, lte: reminderCutoff },
    trialReminderSentAt: null,
  },
  select: { id: true, companyId: true, trialEndAt: true },
});

let remindersSent = 0;
for (const sub of reminderRows) {
  const admins = await db.user.findMany({
    where: { companyId: sub.companyId, orgRole: { in: ['ceo', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  for (const u of admins) {
    await db.$executeRawUnsafe(
      `INSERT INTO notifications (id, company_id, user_id, type, title, body, metadata, expires_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'Your trial ends soon',
               'verify script', '{}'::jsonb, now() + interval '90 days')`,
      sub.companyId,
      u.id,
      REMINDER_TYPE,
    );
    remindersSent += 1;
  }
  await db.subscription.update({
    where: { id: sub.id },
    data: { trialReminderSentAt: now },
  });
}

const expiredRows = await db.subscription.findMany({
  where: { status: 'trialing', trialEndAt: { lt: now } },
  select: { id: true, companyId: true },
});

let expired = 0;
for (const sub of expiredRows) {
  await db.$transaction([
    db.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } }),
    db.company.update({ where: { id: sub.companyId }, data: { status: 'expired' } }),
  ]);
  const admins = await db.user.findMany({
    where: { companyId: sub.companyId, orgRole: { in: ['ceo', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  for (const u of admins) {
    await db.$executeRawUnsafe(
      `INSERT INTO notifications (id, company_id, user_id, type, title, body, metadata, expires_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'Your trial has ended',
               'verify script', '{}'::jsonb, now() + interval '90 days')`,
      sub.companyId,
      u.id,
      EXPIRED_TYPE,
    );
  }
  expired += 1;
}

// --- Assertions ------------------------------------------------------
const subA = await db.subscription.findUnique({ where: { id: a.id } });
const subB = await db.subscription.findUnique({ where: { id: b.id } });
const subC = await db.subscription.findUnique({ where: { id: c.id } });
const compC = await db.company.findUnique({
  where: { id: c.companyId },
  select: { status: true },
});
const finalNotifCount = await db.notification.count({
  where: { type: { in: [REMINDER_TYPE, EXPIRED_TYPE] } },
});

const checks = [
  ['A: still trialing, no reminder', subA.status === 'trialing' && subA.trialReminderSentAt === null],
  ['B: still trialing, reminder stamped', subB.status === 'trialing' && subB.trialReminderSentAt !== null],
  ['C: status flipped to expired', subC.status === 'expired'],
  ['C: companies.status synced to expired', compC.status === 'expired'],
  ['notifications inserted (≥ 2)', finalNotifCount - baselineNotifCount >= 2],
];

console.log('— Run result —');
console.log(`reminderRows evaluated: ${reminderRows.length}`);
console.log(`expiredRows evaluated:  ${expiredRows.length}`);
console.log(`reminders inserted:     ${remindersSent}`);
console.log(`subs expired:           ${expired}`);
console.log(`notifications delta:    ${finalNotifCount - baselineNotifCount}`);
console.log();
console.log('— Assertions —');
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) allOk = false;
}

// --- Restore originals so this script is idempotent across runs. ----
for (const o of originals) {
  await db.subscription.update({
    where: { id: o.id },
    data: {
      status: 'trialing',
      trialEndAt: o.trialEndAt,
      trialReminderSentAt: o.trialReminderSentAt,
    },
  });
  await db.company.update({
    where: { id: o.companyId },
    data: { status: 'trialing' },
  });
}
console.log();
console.log('Restored originals.');

await db.$disconnect();
process.exit(allOk ? 0 : 1);
