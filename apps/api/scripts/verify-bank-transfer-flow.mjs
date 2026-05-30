// Sprint 20.4 verify — full manual bank-transfer flow.
//
// Steps:
//   1. Customer (BankTransferService.createPendingInvoice):
//        → invoice row with status='open', payment_method='bank_transfer'.
//   2. Customer submits reference (BankTransferService.submitReference):
//        → row's payment_reference is set.
//   3. Block: second createPendingInvoice on same tenant must reject
//        (only one outstanding pending invoice at a time).
//   4. Platform operator (BankTransferService.markPaid):
//        → invoice → paid, paid_at set, paid_marked_by set,
//          subscription → active + growth, companies cache synced.
//   5. Idempotent re-mark-paid no-ops.
//
// We import the service from dist/ so we exercise the same code the
// API serves. Snapshots + restores so reruns are safe.

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const { BankTransferService } = await import('../dist/billing/bank-transfer.service.js');
const { PrismaAdminService } = await import('../dist/prisma/prisma-admin.service.js');

// Bank-transfer service refuses to create invoices if BANK_TRANSFER_*
// envs aren't set. Inject a fake set for the verify run so the path
// can execute without a real bank account configured.
process.env.BANK_TRANSFER_ACCOUNT_NAME ??= 'Quantum Tech Agency';
process.env.BANK_TRANSFER_BANK_NAME ??= 'Verify Bank';
process.env.BANK_TRANSFER_IBAN ??= 'IQ00VERIFY0000000000000000';
process.env.BANK_TRANSFER_SWIFT ??= 'VRFYIQBA';

const db = new PrismaClient();
const admin = new PrismaAdminService();
await admin.$connect();
const svc = new BankTransferService(admin);

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No company. Sign up first.');
  process.exit(1);
}
const sub = await db.subscription.findUnique({ where: { companyId: company.id } });
const userId = (
  await db.user.findFirst({
    where: { companyId: company.id, orgRole: 'ceo' },
    select: { id: true },
  })
)?.id;
if (!sub || !userId) {
  console.error('Missing subscription or CEO user.');
  process.exit(1);
}

const snapshot = {
  subStatus: sub.status,
  subPlan: sub.plan,
  subPeriodStart: sub.currentPeriodStart,
  subPeriodEnd: sub.currentPeriodEnd,
  coStatus: company.status,
  coPlan: company.plan,
};

// Clean slate: cancel any pre-existing pending invoices from prior runs.
await db.invoice.deleteMany({
  where: {
    companyId: company.id,
    paymentMethod: 'bank_transfer',
    status: { in: ['open', 'paid'] },
    OR: [{ paymentReference: null }, { paymentReference: { startsWith: 'WIRE-VERIFY-' } }],
  },
});
await db.subscription.update({
  where: { id: sub.id },
  data: { status: 'trialing', plan: 'starter' },
});
await db.company.update({
  where: { id: company.id },
  data: { status: 'trialing', plan: 'starter' },
});

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. Create pending invoice -----------------------------------
const created = await svc.createPendingInvoice(db, { companyId: company.id, userId });
const inv1 = await db.invoice.findUnique({ where: { id: created.id } });
ok('createPendingInvoice → row exists', !!inv1);
ok('createPendingInvoice → status=open', inv1.status === 'open');
ok('createPendingInvoice → payment_method=bank_transfer', inv1.paymentMethod === 'bank_transfer');
ok('createPendingInvoice → payment_provider=null', inv1.paymentProvider === null);
ok('createPendingInvoice → issued_by_user_id set', inv1.issuedByUserId === userId);
ok('createPendingInvoice → amount = 500 USD', inv1.amountCents === 500 && inv1.currency === 'USD');
ok('createPendingInvoice → paid_at null', inv1.paidAt === null);

// --- 2. Submit reference --------------------------------------------
const ref = `WIRE-VERIFY-${randomUUID().slice(0, 8)}`;
await svc.submitReference(db, { companyId: company.id, invoiceId: created.id, reference: ref });
const inv2 = await db.invoice.findUnique({ where: { id: created.id } });
ok('submitReference → payment_reference stored', inv2.paymentReference === ref);

// --- 3. Second create blocked ---------------------------------------
let blocked = false;
let blockedMsg = '';
try {
  await svc.createPendingInvoice(db, { companyId: company.id, userId });
} catch (err) {
  blocked = true;
  blockedMsg = err.message;
}
ok('second createPendingInvoice while open exists → rejected', blocked, blockedMsg.slice(0, 60));

// --- 4. Mark paid ---------------------------------------------------
const marker = userId; // any user id works for the service — controller gates by permission.
await svc.markPaid({ invoiceId: created.id, markerUserId: marker });

const inv3 = await db.invoice.findUnique({ where: { id: created.id } });
ok('markPaid → status=paid', inv3.status === 'paid');
ok('markPaid → paid_at set', inv3.paidAt !== null);
ok('markPaid → paid_marked_by_user_id set', inv3.paidMarkedByUserId === marker);

const subAfter = await db.subscription.findUnique({ where: { id: sub.id } });
const coAfter = await db.company.findUnique({ where: { id: company.id } });
ok('markPaid → subscription status=active', subAfter.status === 'active');
ok('markPaid → subscription plan=growth', subAfter.plan === 'growth');
ok('markPaid → company cache active/growth', coAfter.status === 'active' && coAfter.plan === 'growth');
ok(
  'markPaid → subscription period dates copied',
  subAfter.currentPeriodStart !== null && subAfter.currentPeriodEnd !== null,
);

// --- 5. Idempotent re-mark -------------------------------------------
const re = await svc.markPaid({ invoiceId: created.id, markerUserId: marker });
ok('markPaid re-call → still paid (no error)', re.status === 'paid');

// --- 6. Bad shape: non-bank-transfer invoice cannot be marked ------
const otherInvoice = await db.invoice.create({
  data: {
    companyId: company.id,
    subscriptionId: sub.id,
    amountCents: 500,
    currency: 'USD',
    status: 'open',
    paymentMethod: 'card',
    paymentProvider: 'stripe',
    stripeInvoiceId: 'in_verify_card_' + randomUUID().slice(0, 8),
    issuedByUserId: userId,
  },
});
let forbid = false;
try {
  await svc.markPaid({ invoiceId: otherInvoice.id, markerUserId: marker });
} catch (err) {
  forbid = err.constructor.name === 'ForbiddenException';
}
ok('markPaid rejects non-bank-transfer invoice', forbid);

// --- Restore ---------------------------------------------------------
await db.invoice.deleteMany({
  where: {
    OR: [
      { id: created.id },
      { id: otherInvoice.id },
      { paymentReference: { startsWith: 'WIRE-VERIFY-' } },
    ],
  },
});
await db.subscription.update({
  where: { id: sub.id },
  data: {
    status: snapshot.subStatus,
    plan: snapshot.subPlan,
    currentPeriodStart: snapshot.subPeriodStart,
    currentPeriodEnd: snapshot.subPeriodEnd,
  },
});
await db.company.update({
  where: { id: company.id },
  data: { status: snapshot.coStatus, plan: snapshot.coPlan },
});
console.log('\nRestored originals.');

await db.$disconnect();
await admin.$disconnect();

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
process.exit(failed > 0 ? 1 : 0);
