// Sprint 20.1 verify — insert works for all three invoice shapes that
// Sprint 20 will produce: Paddle (existing), Stripe, manual bank transfer.
// Cleans up the synthetic rows on the way out.

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const db = new PrismaClient();

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
  include: { subscription: { select: { id: true } } },
});
if (!company || !company.subscription) {
  console.error('No company/subscription. Sign up first.');
  process.exit(1);
}

const tag = randomUUID().slice(0, 8);
const created = [];

async function tryInsert(label, data) {
  try {
    const row = await db.invoice.create({ data, select: { id: true } });
    created.push(row.id);
    console.log(`OK   ${label} — id=${row.id}`);
    return true;
  } catch (err) {
    console.log(`FAIL ${label} — ${err.message}`);
    return false;
  }
}

const base = {
  companyId: company.id,
  subscriptionId: company.subscription.id,
  amountCents: 500,
  currency: 'USD',
  status: 'paid',
  billedAt: new Date(),
};

const results = [];
results.push(
  await tryInsert('paddle invoice (paddle_invoice_id set)', {
    ...base,
    paddleInvoiceId: `txn_verify20_paddle_${tag}`,
    paymentProvider: 'paddle',
    paymentMethod: 'card',
  }),
);
results.push(
  await tryInsert('stripe invoice (stripe_invoice_id set)', {
    ...base,
    stripeInvoiceId: `in_verify20_stripe_${tag}`,
    paymentProvider: 'stripe',
    paymentMethod: 'card',
  }),
);
results.push(
  await tryInsert('manual bank transfer (no provider id, has reference)', {
    ...base,
    paymentMethod: 'bank_transfer',
    paymentReference: `WIRE-${tag}`,
  }),
);

// Multi-null collision check: two manual rows with no provider id must
// both insert. UNIQUE WHERE NOT NULL is what makes this safe.
results.push(
  await tryInsert('second manual bank transfer (NULLs do not collide)', {
    ...base,
    paymentMethod: 'bank_transfer',
    paymentReference: `WIRE-${tag}-2`,
  }),
);

// Negative: duplicate paddle id must fail with P2002.
let p2002 = false;
try {
  await db.invoice.create({
    data: {
      ...base,
      paddleInvoiceId: `txn_verify20_paddle_${tag}`,
      paymentProvider: 'paddle',
    },
  });
} catch (err) {
  p2002 = err.code === 'P2002';
}
results.push(p2002);
console.log(`${p2002 ? 'OK  ' : 'FAIL'} duplicate paddle_invoice_id rejected (P2002)`);

// Cleanup
await db.invoice.deleteMany({ where: { id: { in: created } } });
console.log(`\nCleaned ${created.length} synthetic row(s).`);

await db.$disconnect();
process.exit(results.every(Boolean) ? 0 : 1);
