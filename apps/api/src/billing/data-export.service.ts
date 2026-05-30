import { Injectable, Logger } from '@nestjs/common';
import archiver from 'archiver';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { R2Service } from '../r2/r2.service';

// Sprint 20.9 — Tenant data export for offboarding.
//
// Builds a ZIP containing one CSV + one JSON file per tenant-scoped
// table. Stored in R2 at {companyId}/exports/{exportId}.zip with a
// 7-day expiry — the data_exports row tracks status and the cleanup
// sweep removes expired R2 objects.
//
// Tables included: every model that holds tenant data the customer
// might want when leaving us. Webhook event logs, idempotency tables,
// and admin internals (login_attempts, paddle_webhook_events, etc.)
// are deliberately excluded — they're operational, not the customer's.
//
// Runs with the owner Prisma client because the BullMQ processor has
// no tenant context. Every query filters by companyId at the
// application layer so RLS-equivalent isolation is preserved.

const EXPIRY_DAYS = 7;

// Each entry: a logical name + the function that returns the rows.
// Keeping the list explicit (rather than introspecting prisma._dmmf)
// makes it trivial to omit operational tables and to reason about
// which fields each export carries. If a new tenant-scoped model
// lands, it gets added here.
type ExportEntry = {
  name: string;
  rows: (db: PrismaAdminService, companyId: string) => Promise<Record<string, unknown>[]>;
};

const ENTRIES: ExportEntry[] = [
  {
    name: 'company',
    rows: async (db, id) => {
      const c = await db.company.findUnique({ where: { id } });
      return c ? [c as unknown as Record<string, unknown>] : [];
    },
  },
  {
    name: 'company_settings',
    rows: async (db, companyId) =>
      (await db.companySetting.findMany({ where: { companyId } })) as unknown as Record<
        string,
        unknown
      >[],
  },
  {
    name: 'subscriptions',
    rows: (db, companyId) =>
      db.subscription.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'invoices',
    rows: (db, companyId) =>
      db.invoice.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'branches',
    rows: (db, companyId) =>
      db.branch.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'holidays',
    rows: (db, companyId) =>
      db.holiday.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'departments',
    rows: (db, companyId) =>
      db.department.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'teams',
    rows: (db, companyId) =>
      db.team.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'users',
    // PII (national_id is bytea-encrypted, date_of_birth, address,
    // emergency contact) lives on User. We include them — this is THE
    // customer's data export, redacting it here would defeat the
    // purpose. The crypto-rest field stays bytea; opening it requires
    // their own key infrastructure on the customer side.
    rows: (db, companyId) =>
      db.user.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'roles',
    rows: (db, companyId) =>
      db.role.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'user_roles',
    rows: (db, companyId) =>
      db.userRole.findMany({ where: { user: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'user_system_roles',
    rows: (db, companyId) =>
      db.userSystemRole.findMany({ where: { user: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'user_teams',
    rows: (db, companyId) =>
      db.userTeam.findMany({ where: { user: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'tag_categories',
    rows: (db, companyId) =>
      db.tagCategory.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'tags',
    rows: (db, companyId) =>
      db.tag.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'tasks',
    rows: (db, companyId) =>
      db.task.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'task_assignees',
    rows: (db, companyId) =>
      db.taskAssignee.findMany({ where: { task: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'task_tags',
    rows: (db, companyId) =>
      db.taskTag.findMany({ where: { task: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'task_reassignment_requests',
    rows: (db, companyId) =>
      db.taskReassignmentRequest.findMany({ where: { task: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'comments',
    rows: (db, companyId) =>
      db.comment.findMany({ where: { task: { companyId } } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'comment_mentions',
    rows: (db, companyId) =>
      db.commentMention.findMany({
        where: { comment: { task: { companyId } } },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    name: 'notifications',
    rows: (db, companyId) =>
      db.notification.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  {
    name: 'broadcasts',
    rows: (db, companyId) =>
      db.broadcast.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
  // Files: metadata only — we DON'T inline R2 contents into the ZIP
  // (an export could be hundreds of GB). The CSV lists r2_key so the
  // customer can pull individual files via signed URLs if needed.
  {
    name: 'files',
    rows: (db, companyId) =>
      db.file.findMany({ where: { companyId } }) as unknown as Promise<Record<string, unknown>[]>,
  },
  // Activity log is monthly-partitioned; findMany still works.
  {
    name: 'activity_log',
    rows: (db, companyId) =>
      db.activityLog.findMany({ where: { companyId } }) as unknown as Promise<
        Record<string, unknown>[]
      >,
  },
];

@Injectable()
export class DataExportService {
  private readonly log = new Logger(DataExportService.name);

  constructor(
    private readonly admin: PrismaAdminService,
    private readonly r2: R2Service,
  ) {}

  /**
   * Build the export ZIP, upload to R2, and update the data_exports
   * row with the key + expires_at + completed_at. On failure, marks
   * the row 'failed' with a captured reason.
   */
  async run(exportId: string): Promise<void> {
    const row = await this.admin.dataExport.findUnique({
      where: { id: exportId },
      select: { id: true, companyId: true, status: true },
    });
    if (!row) {
      this.log.warn(`data-export ${exportId} missing — nothing to do`);
      return;
    }
    if (row.status !== 'pending') {
      this.log.debug(`data-export ${exportId} status=${row.status}; skipping`);
      return;
    }

    try {
      const buffer = await this.buildArchive(row.companyId);
      const key = `${row.companyId}/exports/${row.id}.zip`;
      await this.r2.putObject({ key, body: buffer, contentType: 'application/zip' });

      const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86_400_000);
      await this.admin.dataExport.update({
        where: { id: row.id },
        data: {
          status: 'ready',
          r2Key: key,
          sizeBytes: BigInt(buffer.byteLength),
          completedAt: new Date(),
          expiresAt,
        },
      });
      this.log.log(
        `data-export ${row.id}: ${buffer.byteLength} bytes, ${ENTRIES.length} entries, expires ${expiresAt.toISOString()}`,
      );
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      this.log.error(`data-export ${row.id} failed: ${msg}`);
      await this.admin.dataExport.update({
        where: { id: row.id },
        data: { status: 'failed', failureReason: msg, completedAt: new Date() },
      });
      throw err;
    }
  }

  /**
   * Generate a fresh download URL for a ready export. URL is signed for
   * the remaining time until expires_at (capped at 1 hour so a stolen
   * URL has a small blast radius even within the 7-day window).
   */
  async getDownloadUrl(
    exportId: string,
    companyId: string,
  ): Promise<{ url: string; expiresInSeconds: number } | null> {
    const row = await this.admin.dataExport.findFirst({
      where: { id: exportId, companyId, status: 'ready' },
      select: { r2Key: true, expiresAt: true },
    });
    if (!row?.r2Key || !row.expiresAt) return null;
    const remainingSeconds = Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000));
    if (remainingSeconds <= 0) return null;
    const ttl = Math.min(remainingSeconds, 3600);
    return this.r2.generatePresignedDownloadUrl({ key: row.r2Key, ttlSeconds: ttl });
  }

  // ---- internals ----------------------------------------------------

  private async buildArchive(companyId: string): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    const closed = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', reject);
      archive.on('warning', (warn) => {
        // ENOENT warnings come from missing files we're appending; we
        // only append buffers so this shouldn't fire, but log if it does.
        this.log.warn(`archiver warning: ${(warn as Error).message}`);
      });
    });

    // README first so the customer knows what they got.
    const generatedAt = new Date().toISOString();
    archive.append(this.renderReadme(companyId, generatedAt), { name: 'README.txt' });

    for (const entry of ENTRIES) {
      const rows = await entry.rows(this.admin, companyId);
      archive.append(JSON.stringify(rows, jsonReplacer, 2), { name: `${entry.name}.json` });
      archive.append(rowsToCsv(rows), { name: `${entry.name}.csv` });
    }

    await archive.finalize();
    await closed;
    return Buffer.concat(chunks);
  }

  private renderReadme(companyId: string, generatedAt: string): string {
    return [
      'Q Task Manager — Tenant Data Export',
      '====================================',
      ``,
      `Company ID: ${companyId}`,
      `Generated:  ${generatedAt}`,
      `Format:     One CSV + one JSON file per tenant-scoped table.`,
      ``,
      'Notes:',
      '- Files (files.csv) contain METADATA only. R2 objects are not',
      '  bundled in this archive — request individual presigned URLs',
      '  via /files/:id/download if you need the binaries.',
      '- The "national_id" column on users is encrypted at rest. You',
      '  cannot decrypt it without our application-side crypto keys.',
      '- Operational tables (login_attempts, webhook event logs, etc.)',
      "  are intentionally excluded — they're not your data.",
      ``,
    ].join('\n');
  }
}

// Convert an array of plain objects to a CSV string. We pick the
// header column set from the first row; rows with missing columns get
// empty cells. Same RFC 4180 quoting convention as the reports CSV.
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set()),
  );
  const lines: string[] = [];
  lines.push(headers.map(csvCell).join(','));
  for (const r of rows) {
    lines.push(headers.map((h) => csvCell(stringify(r[h]))).join(','));
  }
  return '﻿' + lines.join('\n') + '\n';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// CSV-friendly stringify. Nulls → empty; Dates → ISO; bigints → string;
// Buffers → base64 (matches what jsonReplacer does below).
function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (typeof v === 'object') return JSON.stringify(v, jsonReplacer);
  return String(v);
}

// JSON.stringify replacer for types Postgres returns that don't have a
// default JSON form: bigint → string, Buffer → base64-encoded string.
// Date instances handle themselves via toJSON.
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  // Prisma returns bytea as Uint8Array in some shapes; coerce to base64.
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
}
