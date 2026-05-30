// Sprint 20.6 verify — simulates an unpaid invoice over time and
// asserts each band transition fires correctly.
//
// Strategy:
//   1. Pick first company, snapshot state.
//   2. For each of the 5 bands (day 3, 8, 15, 31, 121), rewind
//      past_due_at to (now - daysInBand), run the processor, assert
//      the expected DB transitions.
//   3. Reset clearable fields between runs so each band is evaluated
//      in isolation (the processor only ADVANCES — the test wants to
//      check each band edge, not the cumulative steady state).
//   4. Restore.
//
// Calls the processor's .process() directly. We replicate the
// InjectQueue boundary by constructing the queue ourselves; the
// in-memory shim records enqueued jobs without needing Redis.

import { PrismaClient } from '@prisma/client';

const { PastDueLifecycleProcessor } = await import(
  '../dist/queue/past-due-lifecycle.processor.js'
);

const db = new PrismaClient();
const DAY_MS = 86_400_000;

// In-memory shims for the constructor deps.
const enqueued = [];
const queueShim = { add: async (name, data) => enqueued.push({ name, data }) };
const notificationsShim = {
  create: async () => ({ id: 'noop-' + Date.now() }),
};
const proc = new PastDueLifecycleProcessor(notificationsShim, queueShim);

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
const sub = await db.subscription.findUnique({ where: { companyId: company.id } });
if (!company || !sub) {
  console.error('Need a company + subscription.');
  process.exit(1);
}

const snapshot = {
  subStatus: sub.status,
  subPastDueAt: sub.pastDueAt,
  subWarnSent: sub.pastDueWarningSentAt,
  subDelQueued: sub.deletionEnqueuedAt,
  coStatus: company.status,
  coReadOnly: company.readOnlyAt,
};

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function resetToPastDue(daysAgo) {
  await db.subscription.update({
    where: { id: sub.id },
    data: {
      status: 'past_due',
      pastDueAt: new Date(Date.now() - daysAgo * DAY_MS),
      pastDueWarningSentAt: null,
      deletionEnqueuedAt: null,
    },
  });
  await db.company.update({
    where: { id: company.id },
    data: { status: 'past_due', readOnlyAt: null },
  });
}

// --- Band 1: day 3 (warning) ----------------------------------------
await resetToPastDue(3);
const r1 = await proc.process();
const after1 = await db.subscription.findUnique({ where: { id: sub.id } });
const after1Co = await db.company.findUnique({ where: { id: company.id } });
ok('day 3: warning sent', r1.warnedToday >= 1 && after1.pastDueWarningSentAt !== null);
ok('day 3: status stays past_due', after1.status === 'past_due');
ok('day 3: read_only_at not set yet', after1Co.readOnlyAt === null);

// Re-run at same day → idempotent (no second warning).
const r1b = await proc.process();
ok('day 3 re-run: idempotent (no new warning)', r1b.warnedToday === 0);

// --- Band 2: day 8 (read-only) --------------------------------------
await resetToPastDue(8);
const r2 = await proc.process();
const after2Co = await db.company.findUnique({ where: { id: company.id } });
ok('day 8: read_only_at set', r2.readOnly === 1 && after2Co.readOnlyAt !== null);
const r2b = await proc.process();
ok('day 8 re-run: idempotent (read_only_at not re-stamped)', r2b.readOnly === 0);

// --- Band 3: day 15 (paused) -----------------------------------------
await resetToPastDue(15);
const r3 = await proc.process();
const after3 = await db.subscription.findUnique({ where: { id: sub.id } });
const after3Co = await db.company.findUnique({ where: { id: company.id } });
ok('day 15: status=paused', r3.suspended === 1 && after3.status === 'paused');
ok('day 15: company cache synced', after3Co.status === 'paused');
const r3b = await proc.process();
ok('day 15 re-run: idempotent', r3b.suspended === 0);

// --- Band 4: day 31 (expired) ---------------------------------------
await resetToPastDue(31);
const r4 = await proc.process();
const after4 = await db.subscription.findUnique({ where: { id: sub.id } });
const after4Co = await db.company.findUnique({ where: { id: company.id } });
ok('day 31: status=expired', r4.locked === 1 && after4.status === 'expired');
ok('day 31: company cache synced', after4Co.status === 'expired');
const r4b = await proc.process();
ok('day 31 re-run: idempotent', r4b.locked === 0);

// --- Band 5: day 121 (deletion enqueued, NOT executed) ----------------
const beforeQueueLen = enqueued.length;
await resetToPastDue(121);
const r5 = await proc.process();
const after5 = await db.subscription.findUnique({ where: { id: sub.id } });
ok('day 121: deletion enqueued', r5.deletionEnqueued === 1);
ok('day 121: deletion_enqueued_at stamped', after5.deletionEnqueuedAt !== null);
ok('day 121: job sent to queue', enqueued.length === beforeQueueLen + 1);
ok(
  'day 121: queued payload has companyId',
  enqueued[enqueued.length - 1].data?.companyId === company.id,
);
const r5b = await proc.process();
ok('day 121 re-run: idempotent (no second enqueue)', r5b.deletionEnqueued === 0);

// --- Restore --------------------------------------------------------
await db.subscription.update({
  where: { id: sub.id },
  data: {
    status: snapshot.subStatus,
    pastDueAt: snapshot.subPastDueAt,
    pastDueWarningSentAt: snapshot.subWarnSent,
    deletionEnqueuedAt: snapshot.subDelQueued,
  },
});
await db.company.update({
  where: { id: company.id },
  data: { status: snapshot.coStatus, readOnlyAt: snapshot.coReadOnly },
});
console.log('\nRestored originals.');

await db.$disconnect();

const failed = results.filter((r) => !r.passed).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`,
);
process.exit(failed > 0 ? 1 : 0);
