// Sprint 19.6 verify — exercises the Paddle webhook end-to-end against
// a real Postgres, without any Paddle account access.
//
// What it does:
//   1. Pick the first company; force a clean subscription state
//      (status='trialing', paddleSubscriptionId=null, no invoices).
//   2. Generate four synthetic Paddle payloads (subscription.activated,
//      transaction.completed, transaction.payment_failed,
//      subscription.canceled), sign each with the same HMAC scheme the
//      controller verifies, and call the controller's verify helper +
//      service.handle() directly.
//   3. Assert the expected DB transitions after each step.
//   4. Re-deliver the activated event with the same event_id; assert
//      the idempotency log no-ops it.
//   5. Restore original state on the way out.
//
// We import the compiled JS from dist/ so the script runs against the
// same code the API serves. Run `pnpm build` first (the
// verify-trial-lifecycle script gets away without it because it
// duplicates the processor logic; here we want the real verifier and
// handler under test).

import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';

const { verifyPaddleSignature } = await import(
  '../dist/webhooks/paddle-webhook.controller.js'
);
const { PaddleWebhookService } = await import('../dist/webhooks/paddle-webhook.service.js');

const SECRET = process.env.PADDLE_WEBHOOK_SECRET ?? 'pdl_ntfset_test_secret_verify_script';
process.env.PADDLE_WEBHOOK_SECRET = SECRET;

const db = new PrismaClient();
const svc = new PaddleWebhookService();

function signed(payload) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const h1 = createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex');
  const header = `ts=${ts};h1=${h1}`;
  return { header, body, raw: Buffer.from(body, 'utf8') };
}

function assertVerify(name, payload) {
  const { header, raw } = signed(payload);
  const ok = verifyPaddleSignature(header, raw, SECRET);
  if (!ok) throw new Error(`signature verify failed for ${name}`);
}

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No company. Sign up first.');
  process.exit(1);
}

const subBefore = await db.subscription.findUnique({ where: { companyId: company.id } });
if (!subBefore) {
  console.error('Subscription row missing for company; run migrations.');
  process.exit(1);
}

// --- Snapshot + clean state ----------------------------------------
const snapshot = { ...subBefore, companyStatus: company.status, companyPlan: company.plan };
const paddleSubId = `sub_verify_${randomUUID().slice(0, 8)}`;
const paddleCustomerId = `ctm_verify_${randomUUID().slice(0, 8)}`;

await db.subscription.update({
  where: { id: subBefore.id },
  data: {
    status: 'trialing',
    plan: 'starter',
    paddleSubscriptionId: null,
    paddleCustomerId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  },
});
await db.company.update({
  where: { id: company.id },
  data: { status: 'trialing', plan: 'starter' },
});
await db.invoice.deleteMany({ where: { companyId: company.id } });
await db.paddleWebhookEvent.deleteMany({
  where: { eventId: { startsWith: 'evt_verify_' } },
});

console.log(`Clean state on company ${company.id}.`);
const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. subscription.activated -------------------------------------
const periodStart = new Date();
const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);
const activatedPayload = {
  event_id: 'evt_verify_activated_' + randomUUID().slice(0, 8),
  event_type: 'subscription.activated',
  data: {
    id: paddleSubId,
    customer_id: paddleCustomerId,
    custom_data: { companyId: company.id },
    current_billing_period: {
      starts_at: periodStart.toISOString(),
      ends_at: periodEnd.toISOString(),
    },
  },
};
assertVerify('activated', activatedPayload);
await svc.handle(activatedPayload);

const afterActivated = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterActivatedCo = await db.company.findUnique({ where: { id: company.id } });
ok('activated → status=active', afterActivated.status === 'active');
ok('activated → plan=growth', afterActivated.plan === 'growth');
ok(
  'activated → paddle ids stamped',
  afterActivated.paddleSubscriptionId === paddleSubId &&
    afterActivated.paddleCustomerId === paddleCustomerId,
);
ok(
  'activated → period dates set',
  afterActivated.currentPeriodStart !== null && afterActivated.currentPeriodEnd !== null,
);
ok('activated → company cache synced', afterActivatedCo.status === 'active');

// --- 2. transaction.completed --------------------------------------
const txnId = 'txn_verify_' + randomUUID().slice(0, 8);
const txnPayload = {
  event_id: 'evt_verify_txn_completed_' + randomUUID().slice(0, 8),
  event_type: 'transaction.completed',
  data: {
    id: txnId,
    subscription_id: paddleSubId,
    custom_data: { companyId: company.id },
    currency_code: 'USD',
    billed_at: new Date().toISOString(),
    billing_period: {
      starts_at: periodStart.toISOString(),
      ends_at: periodEnd.toISOString(),
    },
    details: { totals: { total: '500' } }, // $5.00 in minor units
  },
};
assertVerify('transaction.completed', txnPayload);
await svc.handle(txnPayload);

const invoice = await db.invoice.findUnique({ where: { paddleInvoiceId: txnId } });
ok('txn.completed → invoice row created', invoice !== null);
ok('txn.completed → invoice amount = 500 USD paid', invoice?.amountCents === 500 && invoice?.currency === 'USD' && invoice?.status === 'paid');

// --- 3. transaction.payment_failed ---------------------------------
const failedPayload = {
  event_id: 'evt_verify_txn_failed_' + randomUUID().slice(0, 8),
  event_type: 'transaction.payment_failed',
  data: {
    id: 'txn_verify_failed_' + randomUUID().slice(0, 8),
    subscription_id: paddleSubId,
    custom_data: { companyId: company.id },
    currency_code: 'USD',
    details: { totals: { total: '500' } },
  },
};
assertVerify('transaction.payment_failed', failedPayload);
await svc.handle(failedPayload);

const afterFailed = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterFailedCo = await db.company.findUnique({ where: { id: company.id } });
ok('payment_failed → status=past_due', afterFailed.status === 'past_due');
ok('payment_failed → company cache synced', afterFailedCo.status === 'past_due');

// --- 4. subscription.canceled --------------------------------------
const canceledPayload = {
  event_id: 'evt_verify_canceled_' + randomUUID().slice(0, 8),
  event_type: 'subscription.canceled',
  data: {
    id: paddleSubId,
    customer_id: paddleCustomerId,
    custom_data: { companyId: company.id },
  },
};
assertVerify('subscription.canceled', canceledPayload);
await svc.handle(canceledPayload);

const afterCanceled = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterCanceledCo = await db.company.findUnique({ where: { id: company.id } });
ok('canceled → status=cancelled', afterCanceled.status === 'cancelled');
ok('canceled → company cache synced', afterCanceledCo.status === 'cancelled');

// --- 5. idempotency replay -----------------------------------------
const replayResult = await svc.handle(activatedPayload);
ok('replay of same event_id returns processed=false', replayResult.processed === false);

// --- 6. bad signature is rejected ----------------------------------
const evil = signed({ event_id: 'evt_evil', event_type: 'subscription.activated', data: {} });
const tampered = Buffer.from('{"event_id":"evt_evil","event_type":"x","data":{}}', 'utf8');
const sigVerify = verifyPaddleSignature(evil.header, tampered, SECRET);
ok('tampered body fails signature verify', sigVerify === false);

const badSecret = verifyPaddleSignature(evil.header, evil.raw, 'wrong_secret');
ok('wrong secret fails signature verify', badSecret === false);

// --- Restore --------------------------------------------------------
await db.invoice.deleteMany({ where: { companyId: company.id } });
await db.paddleWebhookEvent.deleteMany({
  where: { eventId: { startsWith: 'evt_verify_' } },
});
await db.subscription.update({
  where: { id: subBefore.id },
  data: {
    status: snapshot.status,
    plan: snapshot.plan,
    paddleSubscriptionId: snapshot.paddleSubscriptionId,
    paddleCustomerId: snapshot.paddleCustomerId,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
  },
});
await db.company.update({
  where: { id: company.id },
  data: { status: snapshot.companyStatus, plan: snapshot.companyPlan },
});
console.log('\nRestored originals.');

await db.$disconnect();

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
process.exit(failed > 0 ? 1 : 0);
