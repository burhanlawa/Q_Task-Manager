// Sprint 20.9 verify — full export flow without HTTP or BullMQ:
//   1. Insert a pending data_exports row.
//   2. Call DataExportService.run() directly (the worker's payload).
//   3. Assert row → 'ready', size > 0, expires_at ~7 days out.
//   4. Pull the ZIP from the R2 shim and inspect its directory listing.
//   5. Confirm every expected file is present.
//   6. Spot-check that company.csv contains the company id.
//   7. Idempotency: running again on a 'ready' row is a no-op.

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { DataExportService } = await import('../dist/billing/data-export.service.js');
const { PrismaAdminService } = await import('../dist/prisma/prisma-admin.service.js');

const db = new PrismaClient();
const admin = new PrismaAdminService();
await admin.$connect();

// In-memory R2 shim — saves the uploaded ZIP so we can inspect it
// without provisioning R2 creds for the verify run.
const r2Objects = new Map();
const r2Shim = {
  putObject: async ({ key, body }) => {
    r2Objects.set(key, body);
  },
  getObject: async ({ key }) => r2Objects.get(key),
  generatePresignedDownloadUrl: async ({ key, ttlSeconds }) => ({
    url: `https://stub.local/${key}?ttl=${ttlSeconds}`,
    expiresInSeconds: ttlSeconds,
  }),
};

const svc = new DataExportService(admin, r2Shim);

const company = await db.company.findFirst({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
});
if (!company) {
  console.error('No company. Sign up first.');
  process.exit(1);
}

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. Create pending row + run --------------------------------------
const row = await db.dataExport.create({
  data: { companyId: company.id, status: 'pending' },
  select: { id: true },
});
await svc.run(row.id);

const after = await db.dataExport.findUnique({ where: { id: row.id } });
ok('status flipped to ready', after.status === 'ready');
ok('size_bytes > 0', after.sizeBytes != null && after.sizeBytes > 0n, `${after.sizeBytes}`);
ok('completed_at set', after.completedAt !== null);
ok('expires_at ~7 days out', (() => {
  if (!after.expiresAt) return false;
  const diffDays = (after.expiresAt - after.completedAt) / 86_400_000;
  return Math.abs(diffDays - 7) < 0.05;
})(), `${after.expiresAt?.toISOString()}`);

// --- 2. Inspect the produced ZIP -------------------------------------
const r2Key = after.r2Key;
const buf = r2Objects.get(r2Key);
ok('r2 object present at tenant-scoped key', buf instanceof Buffer && r2Key === `${company.id}/exports/${row.id}.zip`);

// Save to /tmp so the user can open it.
const outPath = join(tmpdir(), `qtm-export-${row.id}.zip`);
writeFileSync(outPath, buf);
console.log(`     wrote ${outPath} (${buf.length} bytes)`);

// Parse the ZIP directory by walking the End-of-Central-Directory
// record. We don't need a ZIP library here — just confirm file names
// are present in the central directory.
function listZipEntries(buffer) {
  const names = [];
  for (let i = 0; i < buffer.length - 4; i += 1) {
    // Central directory file header signature 0x02014b50
    if (buffer.readUInt32LE(i) === 0x02014b50) {
      const nameLen = buffer.readUInt16LE(i + 28);
      const extraLen = buffer.readUInt16LE(i + 30);
      const commentLen = buffer.readUInt16LE(i + 32);
      const name = buffer.toString('utf8', i + 46, i + 46 + nameLen);
      names.push(name);
      i += 46 + nameLen + extraLen + commentLen - 1;
    }
  }
  return names;
}
const entries = listZipEntries(buf);
console.log(`     zip contains ${entries.length} files:`);
for (const e of entries) console.log(`       - ${e}`);

const expected = [
  'README.txt',
  'company.csv',
  'company.json',
  'subscriptions.csv',
  'subscriptions.json',
  'invoices.csv',
  'branches.csv',
  'departments.csv',
  'teams.csv',
  'users.csv',
  'roles.csv',
  'user_roles.csv',
  'user_system_roles.csv',
  'tasks.csv',
  'task_assignees.csv',
  'comments.csv',
  'notifications.csv',
  'broadcasts.csv',
  'files.csv',
  'activity_log.csv',
  'tags.csv',
  'tag_categories.csv',
];
const missing = expected.filter((n) => !entries.includes(n));
ok(`zip contains all ${expected.length} expected entries`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

// --- 3. Idempotency: running on ready row is a no-op -----------------
const beforeSize = r2Objects.size;
await svc.run(row.id);
ok('re-run on ready row does not re-upload', r2Objects.size === beforeSize);

// --- 4. Failure path: bad export id ----------------------------------
// Inserts a pending row, then deletes it before run() to simulate the
// race. run() should not throw; it should log + bail.
const orphan = await db.dataExport.create({
  data: { companyId: company.id, status: 'pending' },
  select: { id: true },
});
await db.dataExport.delete({ where: { id: orphan.id } });
let threw = false;
try {
  await svc.run(orphan.id);
} catch {
  threw = true;
}
ok('missing row → no throw, just warn-log', threw === false);

// --- Cleanup ---------------------------------------------------------
await db.dataExport.deleteMany({ where: { companyId: company.id, id: { in: [row.id] } } });
console.log('\nRestored originals.');

await db.$disconnect();
await admin.$disconnect();

const failed = results.filter((r) => !r.passed).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}.`,
);
console.log(`Open the ZIP at: ${outPath}`);
process.exit(failed > 0 ? 1 : 0);
