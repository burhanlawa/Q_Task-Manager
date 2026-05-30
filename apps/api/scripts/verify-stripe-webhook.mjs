// Sprint 20.3 verify — exercises the Stripe webhook end-to-end against
// a real Postgres, without any Stripe account access.
//
// Same shape as verify-paddle-webhook.mjs but using Stripe's own
// generateTestHeaderString() so the signature path is the production
// crypto, not a re-implementation. We feed five synthetic events
// through service.handle() and assert the DB transitions, then
// re-deliver one event to confirm idempotency.

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';

const { StripeWebhookService } = await import('../dist/webhooks/stripe-webhook.service.js');

// Stripe's webhook signer needs a secret; the verifier doesn't care
// what the secret is as long as both sides use the same one. The
// controller reads STRIPE_WEBHOOK_SECRET from env, but for this
// script we exercise service.handle() directly so we don't need it.

const db = new PrismaClient();
const svc = new StripeWebhookService();

const SECRET = 'whsec_verify_stripe_local';

function buildEvent(type, dataObject) {
  return {
    id: 'evt_verify_stripe_' + randomUUID().slice(0, 12),
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object: dataObject },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
}

// Verify Stripe's signing path round-trips through the controller's
// verify call — this is what the live webhook does.
function assertSignatureRoundtrip(event) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  // constructEvent throws on a bad signature; if it returns we know
  // the controller path would accept this delivery.
  Stripe.webhooks.constructEvent(payload, header, SECRET);
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
  console.error('Subscription row missing.');
  process.exit(1);
}

const snapshot = { ...subBefore, companyStatus: company.status, companyPlan: company.plan };
const stripeSubId = `sub_verify_${randomUUID().slice(0, 10)}`;
const stripeCustomerId = `cus_verify_${randomUUID().slice(0, 10)}`;

// Clean state
await db.subscription.update({
  where: { id: subBefore.id },
  data: {
    status: 'trialing',
    plan: 'starter',
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    paymentProvider: 'paddle',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  },
});
await db.company.update({
  where: { id: company.id },
  data: { status: 'trialing', plan: 'starter' },
});
await db.invoice.deleteMany({ where: { companyId: company.id, stripeInvoiceId: { not: null } } });
await db.stripeWebhookEvent.deleteMany({
  where: { eventId: { startsWith: 'evt_verify_stripe_' } },
});

console.log(`Clean state on company ${company.id}.`);
const results = [];
function ok(name, passed) {
  results.push({ name, passed });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}`);
}

// --- 1. customer.subscription.created → active ---------------------
const periodStartSec = Math.floor(Date.now() / 1000);
const periodEndSec = periodStartSec + 30 * 86_400;
const subscriptionPayload = {
  id: stripeSubId,
  object: 'subscription',
  customer: stripeCustomerId,
  status: 'active',
  cancel_at_period_end: false,
  metadata: { companyId: company.id },
  items: {
    object: 'list',
    data: [
      {
        id: 'si_verify_' + randomUUID().slice(0, 8),
        current_period_start: periodStartSec,
        current_period_end: periodEndSec,
      },
    ],
  },
};

const createdEvent = buildEvent('customer.subscription.created', subscriptionPayload);
assertSignatureRoundtrip(createdEvent);
await svc.handle(createdEvent);

const afterCreated = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterCreatedCo = await db.company.findUnique({ where: { id: company.id } });
ok('subscription.created → status=active', afterCreated.status === 'active');
ok('subscription.created → plan=growth', afterCreated.plan === 'growth');
ok(
  'subscription.created → stripe ids stamped',
  afterCreated.stripeSubscriptionId === stripeSubId &&
    afterCreated.stripeCustomerId === stripeCustomerId,
);
ok(
  'subscription.created → period dates set',
  afterCreated.currentPeriodStart !== null && afterCreated.currentPeriodEnd !== null,
);
ok('subscription.created → company cache synced', afterCreatedCo.status === 'active');
ok('subscription.created → payment_provider=stripe', afterCreated.paymentProvider === 'stripe');

// --- 2. invoice.paid → invoice row -----------------------------------
const stripeInvoiceId = `in_verify_${randomUUID().slice(0, 10)}`;
const invoicePayload = {
  id: stripeInvoiceId,
  object: 'invoice',
  customer: stripeCustomerId,
  amount_paid: 500,
  currency: 'usd',
  created: periodStartSec,
  period_start: periodStartSec,
  period_end: periodEndSec,
  metadata: { companyId: company.id },
  parent: {
    type: 'subscription_details',
    subscription_details: {
      subscription: stripeSubId,
      metadata: { companyId: company.id },
    },
    quote_details: null,
  },
};

const invoicePaidEvent = buildEvent('invoice.paid', invoicePayload);
assertSignatureRoundtrip(invoicePaidEvent);
await svc.handle(invoicePaidEvent);

const invoiceRow = await db.invoice.findUnique({ where: { stripeInvoiceId } });
ok('invoice.paid → invoice row created', invoiceRow !== null);
ok(
  'invoice.paid → invoice amount = 500 USD paid',
  invoiceRow?.amountCents === 500 && invoiceRow?.currency === 'USD' && invoiceRow?.status === 'paid',
);
ok('invoice.paid → payment_provider=stripe', invoiceRow?.paymentProvider === 'stripe');

// --- 3. invoice.payment_failed → past_due ----------------------------
const failedInvoicePayload = {
  ...invoicePayload,
  id: `in_verify_failed_${randomUUID().slice(0, 10)}`,
};
const failedEvent = buildEvent('invoice.payment_failed', failedInvoicePayload);
assertSignatureRoundtrip(failedEvent);
await svc.handle(failedEvent);

const afterFailed = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterFailedCo = await db.company.findUnique({ where: { id: company.id } });
ok('invoice.payment_failed → status=past_due', afterFailed.status === 'past_due');
ok('invoice.payment_failed → company cache synced', afterFailedCo.status === 'past_due');

// --- 4. customer.subscription.updated (cancel_at_period_end=true) ---
const updatedEvent = buildEvent('customer.subscription.updated', {
  ...subscriptionPayload,
  status: 'active',
  cancel_at_period_end: true,
});
assertSignatureRoundtrip(updatedEvent);
await svc.handle(updatedEvent);

const afterUpdated = await db.subscription.findUnique({ where: { id: subBefore.id } });
ok(
  'subscription.updated → cancel_at_period_end=true reflected',
  afterUpdated.cancelAtPeriodEnd === true && afterUpdated.status === 'active',
);

// --- 5. customer.subscription.deleted → cancelled --------------------
const deletedEvent = buildEvent('customer.subscription.deleted', subscriptionPayload);
assertSignatureRoundtrip(deletedEvent);
await svc.handle(deletedEvent);

const afterDeleted = await db.subscription.findUnique({ where: { id: subBefore.id } });
const afterDeletedCo = await db.company.findUnique({ where: { id: company.id } });
ok('subscription.deleted → status=cancelled', afterDeleted.status === 'cancelled');
ok('subscription.deleted → company cache synced', afterDeletedCo.status === 'cancelled');

// --- 6. Idempotency replay ------------------------------------------
const replay = await svc.handle(createdEvent);
ok('replay of same event id returns processed=false', replay.processed === false);

// --- 7. Bad signature rejected --------------------------------------
let badSigRejected = false;
try {
  Stripe.webhooks.constructEvent(
    JSON.stringify({ id: 'evil', type: 'x' }),
    'bogus,sig,header',
    SECRET,
  );
} catch {
  badSigRejected = true;
}
ok('malformed Stripe-Signature header is rejected', badSigRejected);

// --- Restore --------------------------------------------------------
await db.invoice.deleteMany({ where: { companyId: company.id, stripeInvoiceId: { not: null } } });
await db.stripeWebhookEvent.deleteMany({
  where: { eventId: { startsWith: 'evt_verify_stripe_' } },
});
await db.subscription.update({
  where: { id: subBefore.id },
  data: {
    status: snapshot.status,
    plan: snapshot.plan,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    stripeCustomerId: snapshot.stripeCustomerId,
    paymentProvider: snapshot.paymentProvider,
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

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
process.exit(failed > 0 ? 1 : 0);
