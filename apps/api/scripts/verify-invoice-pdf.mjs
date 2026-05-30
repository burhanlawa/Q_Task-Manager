// Sprint 20.5 verify — generate one invoice PDF per locale and save to
// /tmp for visual inspection. Also confirms:
//   - The rendered file is a valid PDF (starts with %PDF-)
//   - Round-tripping through ensurePdf + getPdfBytes lands the same key
//   - Idempotency: second ensurePdf call returns the existing key
//     without re-uploading
//
// Does NOT verify R2 storage (that requires R2 creds). For dev, we
// shim R2Service.putObject/getObject with an in-memory map so the
// renderer can be exercised without provisioned credentials.

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { InvoicePdfService } = await import('../dist/billing/invoice-pdf.service.js');

const db = new PrismaClient();

// In-memory R2 shim. The PDF service only needs putObject + getObject.
const objects = new Map();
const r2Shim = {
  putObject: async ({ key, body }) => {
    objects.set(key, body);
  },
  getObject: async ({ key }) => {
    const buf = objects.get(key);
    if (!buf) throw new Error(`no object ${key}`);
    return buf;
  },
};

const svc = new InvoicePdfService(r2Shim);

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No company.');
  process.exit(1);
}
const sub = await db.subscription.findUnique({ where: { companyId: company.id } });
if (!sub) {
  console.error('No subscription.');
  process.exit(1);
}

const originalLocale = company.defaultLocale;
const created = [];

async function renderOne(locale, paymentMethod) {
  await db.company.update({ where: { id: company.id }, data: { defaultLocale: locale } });
  const inv = await db.invoice.create({
    data: {
      companyId: company.id,
      subscriptionId: sub.id,
      amountCents: 500,
      currency: 'USD',
      status: 'paid',
      paymentMethod,
      paymentProvider: paymentMethod === 'card' ? 'stripe' : null,
      paymentReference: paymentMethod === 'bank_transfer' ? `WIRE-VERIFY-${randomUUID().slice(0, 6)}` : null,
      billedAt: new Date(),
      paidAt: new Date(),
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  created.push(inv.id);

  const key1 = await svc.ensurePdf(db, inv.id, company.id);
  const bytes = await svc.getPdfBytes(key1);

  // Idempotency: second call returns same key, no re-upload.
  const sizeBefore = objects.get(key1).length;
  const key2 = await svc.ensurePdf(db, inv.id, company.id);
  const sizeAfter = objects.get(key2).length;

  const outPath = join(tmpdir(), `qtm-invoice-${locale}-${paymentMethod}.pdf`);
  writeFileSync(outPath, bytes);

  const startsWithPdf = bytes.slice(0, 5).toString() === '%PDF-';
  return {
    locale,
    paymentMethod,
    keyMatches: key1 === key2,
    idempotentNoRegenerate: sizeBefore === sizeAfter,
    isValidPdf: startsWithPdf,
    size: bytes.length,
    path: outPath,
  };
}

const results = [];
for (const locale of ['en', 'ar', 'ckb']) {
  results.push(await renderOne(locale, 'card'));
}
results.push(await renderOne('en', 'bank_transfer'));

let failed = 0;
for (const r of results) {
  const ok = r.isValidPdf && r.keyMatches && r.idempotentNoRegenerate;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} locale=${r.locale} method=${r.paymentMethod} bytes=${r.size} → ${r.path}`,
  );
}

// Cleanup
await db.invoice.deleteMany({ where: { id: { in: created } } });
await db.company.update({ where: { id: company.id }, data: { defaultLocale: originalLocale } });
console.log(`\nCleaned ${created.length} synthetic invoice(s).`);
console.log(`Open the .pdf paths above to visually inspect rendering.`);
await db.$disconnect();

process.exit(failed > 0 ? 1 : 0);
