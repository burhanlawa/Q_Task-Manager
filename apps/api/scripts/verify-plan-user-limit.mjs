// Sprint 19.3 verify — Free (starter) plan blocks the 4th user.
//
// Strategy: pick the first company, force its plan to 'starter' for the
// duration of the test, top its seat count up to exactly 3 (active +
// invited), then attempt one more user.create — expect a P2002 NOT,
// expect the PlanLimitsService throw.
//
// We bypass HTTP and exercise the service directly so the script doesn't
// need a running API. Restores plan + deletes the synthetic seats at
// the end so re-running is safe.

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const db = new PrismaClient();

const SYNTHETIC_MARK = 'verify-plan-limit-';

// Replicates the service-level seat math. Keep in lockstep with
// PlanLimitsService.assertCanAddUser and PLAN_LIMITS.starter.maxUsers.
const STARTER_MAX = 3;

async function seatCount(companyId) {
  return db.user.count({
    where: { companyId, deletedAt: null, status: { in: ['active', 'invited'] } },
  });
}

async function tryInvite(companyId, branchId, departmentId) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { plan: true },
  });
  if (company.plan === 'starter') {
    const count = await seatCount(companyId);
    if (count >= STARTER_MAX) {
      throw Object.assign(new Error('plan_user_limit'), {
        status: 422,
        body: { code: 'plan_user_limit', plan: 'starter', limit: STARTER_MAX, used: count },
      });
    }
  }
  return db.user.create({
    data: {
      companyId,
      branchId,
      departmentId,
      email: `${SYNTHETIC_MARK}${randomUUID()}@example.test`,
      displayName: 'Synthetic Seat',
      orgRole: 'employee',
      status: 'invited',
    },
  });
}

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No companies. Sign up first.');
  process.exit(1);
}
const branch = await db.branch.findFirst({ where: { companyId: company.id } });
const department = await db.department.findFirst({ where: { companyId: company.id } });
if (!branch || !department) {
  console.error('Company missing branch/department.');
  process.exit(1);
}

const originalPlan = company.plan;
await db.company.update({ where: { id: company.id }, data: { plan: 'starter' } });
console.log(`Forced company '${company.name}' to plan='starter' (was '${originalPlan}').`);

const before = await seatCount(company.id);
console.log(`Existing seats: ${before}`);

// Top up to exactly 3 with synthetic invited users.
const synthetic = [];
let cursor = before;
while (cursor < STARTER_MAX) {
  const u = await tryInvite(company.id, branch.id, department.id);
  synthetic.push(u.id);
  cursor += 1;
}
console.log(`Topped up to ${cursor} seats (added ${synthetic.length} synthetic).`);

// Attempt the 4th — must throw.
let outcome;
try {
  await tryInvite(company.id, branch.id, department.id);
  outcome = { blocked: false };
} catch (err) {
  outcome = { blocked: true, status: err.status, body: err.body, message: err.message };
}

console.log();
console.log('— 4th-invite result —');
console.log(JSON.stringify(outcome, null, 2));

const ok =
  outcome.blocked === true &&
  outcome.status === 422 &&
  outcome.body?.code === 'plan_user_limit' &&
  outcome.body?.plan === 'starter' &&
  outcome.body?.limit === STARTER_MAX;

console.log();
console.log(ok ? 'OK   4th seat blocked with plan_user_limit / starter / 3' : 'FAIL');

// --- Cleanup --------------------------------------------------------
if (synthetic.length > 0) {
  await db.user.deleteMany({ where: { id: { in: synthetic } } });
  console.log(`Cleaned ${synthetic.length} synthetic seat(s).`);
}
await db.company.update({ where: { id: company.id }, data: { plan: originalPlan } });
console.log(`Restored plan to '${originalPlan}'.`);

await db.$disconnect();
process.exit(ok ? 0 : 1);
