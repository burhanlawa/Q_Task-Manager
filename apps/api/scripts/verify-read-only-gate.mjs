// Sprint 20.7 verify — read-only gate exercises end-to-end via the
// actual guard pipeline (no HTTP needed). We construct the guard
// manually with shim deps and call canActivate() with fabricated
// ExecutionContexts for each scenario.

import { PrismaClient } from '@prisma/client';
import { Reflector } from '@nestjs/core';

const { BillingStatusGuard, SkipBillingGate } = await import(
  '../dist/auth/billing-status.guard.js'
);

const db = new PrismaClient();

// In-memory cache shim — guard uses Redis cache, but the path
// degrades to no-op when REDIS_URL is unset. We supply a real shim
// that just memoizes locally so each band runs cleanly.
class CacheShim {
  store = new Map();
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async set(key, value) {
    this.store.set(key, value);
  }
  async getOrSet(key, _ttl, loader) {
    if (this.store.has(key)) return this.store.get(key);
    const value = await loader();
    this.store.set(key, value);
    return value;
  }
}

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
const user = await db.user.findFirst({
  where: { companyId: company.id, orgRole: 'ceo' },
  select: { clerkUserId: true },
});
if (!company || !user?.clerkUserId) {
  console.error('Need company + CEO user with clerkUserId.');
  process.exit(1);
}

const snapshot = { status: company.status, readOnlyAt: company.readOnlyAt };

// Build a fake ExecutionContext. The guard reads req.method, req.auth,
// and the metadata via reflector.getAllAndOverride.
function makeCtx({ method, hasAuth = true, skipMeta = false }) {
  const req = {
    method,
    auth: hasAuth ? { userId: user.clerkUserId } : undefined,
  };
  // Apply the real SkipBillingGate decorator so the metadata is
  // stamped with the same symbol the guard's reflector reads.
  const handler = function fakeHandler() {};
  const cls = class FakeController {};
  if (skipMeta) {
    SkipBillingGate()(cls.prototype, 'fakeHandler', { value: handler });
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  };
}

const reflector = new Reflector();
const admin = db; // PrismaClient connected with DATABASE_URL (owner role)
const cache = new CacheShim();
const guard = new BillingStatusGuard(reflector, admin, cache);

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function setCompanyState({ status, readOnlyAt }) {
  await db.company.update({ where: { id: company.id }, data: { status, readOnlyAt } });
  cache.store.clear(); // bust shim so next call re-reads
}

async function tryGuard(ctx) {
  try {
    const allowed = await guard.canActivate(ctx);
    return { allowed, status: null, body: null };
  } catch (err) {
    return {
      allowed: false,
      status: err.getStatus?.() ?? err.status,
      body: err.getResponse?.() ?? err.response ?? null,
    };
  }
}

// --- Baseline: active tenant, write allowed -------------------------
await setCompanyState({ status: 'active', readOnlyAt: null });
let r = await tryGuard(makeCtx({ method: 'POST' }));
ok('active + POST → allowed', r.allowed === true);
r = await tryGuard(makeCtx({ method: 'GET' }));
ok('active + GET → allowed', r.allowed === true);

// --- read_only_at set: writes blocked, reads pass -------------------
await setCompanyState({ status: 'past_due', readOnlyAt: new Date() });
r = await tryGuard(makeCtx({ method: 'POST' }));
ok(
  'read_only_at set + POST → 402 with billing_read_only',
  r.status === 402 && r.body?.code === 'billing_read_only',
  JSON.stringify(r.body?.code),
);
r = await tryGuard(makeCtx({ method: 'PATCH' }));
ok('read_only_at set + PATCH → 402', r.status === 402);
r = await tryGuard(makeCtx({ method: 'DELETE' }));
ok('read_only_at set + DELETE → 402', r.status === 402);
r = await tryGuard(makeCtx({ method: 'GET' }));
ok('read_only_at set + GET → allowed', r.allowed === true);

// --- status=paused (day 14+): blocks even if read_only_at null -----
await setCompanyState({ status: 'paused', readOnlyAt: null });
r = await tryGuard(makeCtx({ method: 'POST' }));
ok('status=paused + POST → 402', r.status === 402);

// --- status=expired (day 30+): blocked -----------------------------
await setCompanyState({ status: 'expired', readOnlyAt: null });
r = await tryGuard(makeCtx({ method: 'POST' }));
ok('status=expired + POST → 402', r.status === 402);

// --- status=cancelled: blocked -------------------------------------
await setCompanyState({ status: 'cancelled', readOnlyAt: null });
r = await tryGuard(makeCtx({ method: 'POST' }));
ok('status=cancelled + POST → 402', r.status === 402);

// --- status=past_due (day 1-6, no read_only_at yet): NOT blocked ---
// Grace window — user is still allowed to use the app while their
// retried card succeeds.
await setCompanyState({ status: 'past_due', readOnlyAt: null });
r = await tryGuard(makeCtx({ method: 'POST' }));
ok('status=past_due (grace) + POST → allowed', r.allowed === true);

// --- @SkipBillingGate exemption ------------------------------------
await setCompanyState({ status: 'expired', readOnlyAt: new Date() });
r = await tryGuard(makeCtx({ method: 'POST', skipMeta: true }));
ok('SkipBillingGate + POST → allowed even when expired', r.allowed === true);

// --- No auth (webhook path) ----------------------------------------
r = await tryGuard(makeCtx({ method: 'POST', hasAuth: false }));
ok('no auth (webhook) + POST → allowed', r.allowed === true);

// --- Restore --------------------------------------------------------
await setCompanyState(snapshot);
console.log('\nRestored originals.');
await db.$disconnect();

const failed = results.filter((r) => !r.passed).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`,
);
process.exit(failed > 0 ? 1 : 0);
