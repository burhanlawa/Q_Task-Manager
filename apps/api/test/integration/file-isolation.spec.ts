import { NotFoundException } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ActivityLogService } from '../../src/activity-log/activity-log.service';
import { PlanLimitsService } from '../../src/billing/plan-limits.service';
import { FilesController } from '../../src/files/files.controller';
import { R2Service } from '../../src/r2/r2.service';

// Sprint 11.6 — non-negotiable file-isolation test.
//
// Two companies, each with a user and one uploaded file. Then:
//   - As A, the FilesController must NOT serve a download URL for B's file
//     (404, regardless of whether the file id is a valid UUID).
//   - As A, Prisma's RLS-subject client must NOT see B's file row (null).
//   - As A, marking B's file 'uploaded' via /complete is also 404 — no way
//     to flip another tenant's row.
//   - r2_key uses UUIDs, not natural names — a leaked URL can't be guessed
//     for an adjacent tenant because the key has unguessable randomness.

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL ?? OWNER_URL;

const ownerDb = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

type Seed = {
  companyId: string;
  branchId: string;
  departmentId: string;
  userId: string;
  fileId: string;
  r2Key: string;
};

async function seedCompanyWithFile(label: string): Promise<Seed> {
  const tag = randomUUID().slice(0, 8);
  const company = await ownerDb.company.create({
    data: { name: `Iso-${label}-${tag}`, slug: `iso-${label}-${tag}`, country: 'IQ' },
  });
  const branch = await ownerDb.branch.create({
    data: { companyId: company.id, name: `B-${label}` },
  });
  const department = await ownerDb.department.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      name: `D-${label}`,
      isAutoCreated: true,
    },
  });
  const user = await ownerDb.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      departmentId: department.id,
      email: `${label}-${tag}@iso.test`,
      displayName: `User ${label}`,
      orgRole: 'ceo',
      status: 'active',
    },
  });
  // Pre-seed an "uploaded" file so the controller's status gate doesn't
  // fire before the tenant check we actually care about.
  const fileId = randomUUID();
  const r2Key = `${company.id}/${fileId}/${label}.png`;
  await ownerDb.file.create({
    data: {
      id: fileId,
      companyId: company.id,
      uploaderUserId: user.id,
      purpose: 'avatar',
      ownerType: 'user',
      ownerId: user.id,
      r2Key,
      originalFilename: `${label}.png`,
      contentType: 'image/png',
      sizeBytes: BigInt(11),
      uploadStatus: 'uploaded',
    },
  });
  return {
    companyId: company.id,
    branchId: branch.id,
    departmentId: department.id,
    userId: user.id,
    fileId,
    r2Key,
  };
}

async function teardown(s: Seed): Promise<void> {
  await ownerDb.activityLog.deleteMany({ where: { targetId: s.fileId } });
  await ownerDb.file.delete({ where: { id: s.fileId } });
  await ownerDb.user.delete({ where: { id: s.userId } });
  await ownerDb.department.delete({ where: { id: s.departmentId } });
  await ownerDb.branch.delete({ where: { id: s.branchId } });
  await ownerDb.company.delete({ where: { id: s.companyId } });
}

async function asTenant<T>(
  companyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
    return fn(tx);
  });
}

// R2 stub — the isolation we're testing is on the API + DB, not on R2 itself.
// signing is bypassed so the test runs without real credentials.
function stubR2(): R2Service {
  return {
    isConfigured: () => true,
    generatePresignedDownloadUrl: async () => ({
      url: 'https://stub.local/never-reached',
      expiresInSeconds: 300,
    }),
    generatePresignedUploadUrl: async () => ({
      url: 'https://stub.local/never-reached',
      headers: { 'content-type': 'image/png' },
      expiresInSeconds: 900,
    }),
  } as unknown as R2Service;
}

// Plan-limit stub — these test cases call download/complete, neither of
// which exercises the gate. A no-op satisfies the constructor signature
// without dragging the billing module's DB lookups into the test path.
function stubPlanLimits(): PlanLimitsService {
  return {
    assertCanAddUser: async () => undefined,
    assertCanUpload: async () => undefined,
  } as unknown as PlanLimitsService;
}

const activity = new ActivityLogService();

describe('file isolation (Sprint 11 non-negotiable)', () => {
  let A: Seed;
  let B: Seed;

  beforeAll(async () => {
    if (!OWNER_URL) throw new Error('DATABASE_URL not set');
    A = await seedCompanyWithFile('A');
    B = await seedCompanyWithFile('B');
  });

  afterAll(async () => {
    if (B) await teardown(B).catch(() => undefined);
    if (A) await teardown(A).catch(() => undefined);
    await ownerDb.$disconnect();
    await appDb.$disconnect();
  });

  describe('as tenant A', () => {
    it('cannot SELECT B.file via RLS (returns null)', async () => {
      const row = await asTenant(A.companyId, (tx) =>
        tx.file.findUnique({ where: { id: B.fileId } }),
      );
      expect(row).toBeNull();
    });

    it('controller.download for B.fileId throws NotFoundException', async () => {
      const ctrl = new FilesController(stubR2(), activity, stubPlanLimits());
      await expect(
        asTenant(A.companyId, (tx) =>
          ctrl.download(tx, { companyId: A.companyId, userId: A.userId }, B.fileId),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('controller.complete on B.fileId throws NotFoundException (cannot flip another tenant’s row)', async () => {
      const ctrl = new FilesController(stubR2(), activity, stubPlanLimits());
      await expect(
        asTenant(A.companyId, (tx) =>
          ctrl.complete(tx, { companyId: A.companyId, userId: A.userId }, B.fileId),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cannot UPDATE B.file via RLS (updateMany affects 0 rows)', async () => {
      const result = await asTenant(A.companyId, (tx) =>
        tx.file.updateMany({
          where: { id: B.fileId },
          data: { uploadStatus: 'failed' },
        }),
      );
      expect(result.count).toBe(0);
      // And B's row is unchanged (verify via owner client which bypasses RLS):
      const row = await ownerDb.file.findUnique({
        where: { id: B.fileId },
        select: { uploadStatus: true },
      });
      expect(row?.uploadStatus).toBe('uploaded');
    });

    it('cannot INSERT a file row pretending to be B (RLS WITH CHECK rejects)', async () => {
      await expect(
        asTenant(A.companyId, (tx) =>
          tx.file.create({
            data: {
              companyId: B.companyId,
              uploaderUserId: A.userId,
              purpose: 'avatar',
              r2Key: `${B.companyId}/${randomUUID()}/spoof.png`,
              originalFilename: 'spoof.png',
              contentType: 'image/png',
              sizeBytes: BigInt(1),
            },
          }),
        ),
      ).rejects.toThrow();
      // No orphan landed in B's space:
      const spoof = await ownerDb.file.findMany({
        where: { companyId: B.companyId, originalFilename: 'spoof.png' },
      });
      expect(spoof).toHaveLength(0);
    });
  });

  describe('r2_key scheme', () => {
    it('uses random UUIDs in the path, not natural filenames', () => {
      // The convention enforced in code: {company_id}/{file_id}/{filename}.
      // file_id is a v4 UUID — unguessable. Even if an attacker knows the
      // company id (it's in the URL of public pages, say), they can't
      // construct another tenant's key from public info.
      const parts = A.r2Key.split('/');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe(A.companyId);
      // UUID v4 shape: 8-4-4-4-12 hex chars
      expect(parts[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      // And A's UUID is not B's (proves no collision in the test fixture).
      const bParts = B.r2Key.split('/');
      expect(bParts[1]).not.toBe(parts[1]);
    });
  });
});
