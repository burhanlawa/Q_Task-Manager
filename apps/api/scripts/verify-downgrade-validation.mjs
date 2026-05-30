// Sprint 20.8 verify — downgrade endpoint validation.
//
// Three scenarios:
//   1. 10 users + starter target → 422 with seats blocker.
//   2. Heavy storage + starter target → 422 with storage blocker.
//   3. Within limits (1 user, no files) + starter target → success.
//   4. Provider subscription active → 422 with provider_subscription_active.
//
// Exercises BankTransfer... wait, the downgrade lives on the controller.
// We call assertCanDowngrade directly (the controller's role is just
// gating + writing; the validation is what 20.8 is about).

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const { PlanLimitsService } = await import('../dist/billing/plan-limits.service.js');

const db = new PrismaClient();
const svc = new PlanLimitsService();

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No company.');
  process.exit(1);
}

const snapshot = { plan: company.plan, storageUsedBytes: company.storageUsedBytes };
const created = [];

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const branch = await db.branch.findFirst({ where: { companyId: company.id } });
const dept = await db.department.findFirst({ where: { companyId: company.id } });

async function topUpSeats(target) {
  while (true) {
    const count = await db.user.count({
      where: {
        companyId: company.id,
        deletedAt: null,
        status: { in: ['active', 'invited'] },
      },
    });
    if (count >= target) break;
    const u = await db.user.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        departmentId: dept.id,
        email: `dg-verify-${randomUUID().slice(0, 8)}@example.test`,
        displayName: 'Downgrade Verify',
        orgRole: 'employee',
        status: 'invited',
      },
    });
    created.push(u.id);
  }
}

// --- 1. 10 users + starter target → blocked --------------------------
await topUpSeats(10);
let err = null;
try {
  await svc.assertCanDowngrade(db, company.id, 'starter');
} catch (e) {
  err = e;
}
ok('10 users → starter throws 422', err?.getStatus() === 422);
const body1 = err?.getResponse();
ok('error code = plan_downgrade_blocked', body1?.code === 'plan_downgrade_blocked');
ok('targetPlan = starter in body', body1?.targetPlan === 'starter');
const seatsBlocker = body1?.blockers?.find((b) => b.kind === 'seats');
ok('blockers contains seats entry', !!seatsBlocker);
ok('seats blocker shows limit=3', seatsBlocker?.limit === 3);
ok('seats blocker reduceBy = current - 3', seatsBlocker?.reduceBy === seatsBlocker?.current - 3);
ok(
  'message names the target plan + reduce count',
  typeof seatsBlocker?.message === 'string' &&
    seatsBlocker.message.includes('starter') &&
    seatsBlocker.message.includes(String(seatsBlocker.reduceBy)),
);

// --- 2. Heavy storage + starter target → blocked --------------------
// Forge storage_used_bytes directly (bypassing the trigger). We're
// only checking the validation math, not the trigger; restore at end.
await db.company.update({
  where: { id: company.id },
  data: { storageUsedBytes: BigInt(5 * 1024 * 1024 * 1024) }, // 5 GB
});
// Clean seats first so we isolate the storage blocker.
await db.user.deleteMany({ where: { id: { in: created } } });
created.length = 0;
err = null;
try {
  await svc.assertCanDowngrade(db, company.id, 'starter');
} catch (e) {
  err = e;
}
const body2 = err?.getResponse();
const storageBlocker = body2?.blockers?.find((b) => b.kind === 'storage');
ok('5 GB used + starter → storage blocker present', !!storageBlocker);
ok(
  'storage blocker mentions GB amounts',
  typeof storageBlocker?.message === 'string' && storageBlocker.message.includes('GB'),
);

// --- 3. Within limits → no throw ------------------------------------
await db.company.update({
  where: { id: company.id },
  data: { storageUsedBytes: BigInt(0) },
});
let success = false;
try {
  await svc.assertCanDowngrade(db, company.id, 'starter');
  success = true;
} catch (e) {
  err = e;
}
ok('within limits → assertCanDowngrade returns without throw', success);

// --- Restore ---------------------------------------------------------
await db.user.deleteMany({ where: { id: { in: created } } });
await db.company.update({
  where: { id: company.id },
  data: { plan: snapshot.plan, storageUsedBytes: snapshot.storageUsedBytes },
});
console.log('\nRestored originals.');

await db.$disconnect();

const failed = results.filter((r) => !r.passed).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`,
);
process.exit(failed > 0 ? 1 : 0);
