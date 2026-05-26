import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

// Two clients, one per role:
//   ownerDb  → DATABASE_URL (neondb_owner): seeds and cleans up; bypasses RLS.
//   appDb    → APP_DATABASE_URL (app_user): subject to RLS. All "as user A"
//              probes go through this client inside a transaction that has
//              set_config('app.current_company_id', <A>, true).
//
// The whole point of this suite: when appDb runs as company A, B's data must
// be invisible (SELECT) and unwritable (UPDATE/INSERT).

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL ?? OWNER_URL;

const ownerDb = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

type Seeded = {
  companyId: string;
  branchId: string;
  departmentId: string;
  userId: string;
};

async function seedCompany(label: string): Promise<Seeded> {
  // Unique slug/email so reruns can coexist if cleanup ever fails partially.
  const tag = randomUUID().slice(0, 8);
  const company = await ownerDb.company.create({
    data: { name: `Test-${label}-${tag}`, slug: `test-${label}-${tag}`, country: 'IQ' },
  });
  const branch = await ownerDb.branch.create({
    data: { companyId: company.id, name: `Branch-${label}` },
  });
  const department = await ownerDb.department.create({
    data: { companyId: company.id, branchId: branch.id, name: `Dept-${label}`, isAutoCreated: true },
  });
  const user = await ownerDb.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      departmentId: department.id,
      email: `${label}-${tag}@isolation.test`,
      displayName: `User ${label}`,
      orgRole: 'ceo',
      status: 'active',
    },
  });
  return { companyId: company.id, branchId: branch.id, departmentId: department.id, userId: user.id };
}

async function deleteCompany(s: Seeded): Promise<void> {
  // Order matters: FKs are Restrict on company.
  await ownerDb.user.delete({ where: { id: s.userId } });
  await ownerDb.department.delete({ where: { id: s.departmentId } });
  await ownerDb.branch.delete({ where: { id: s.branchId } });
  await ownerDb.company.delete({ where: { id: s.companyId } });
}

// Helper: run `fn` with app.current_company_id bound to `companyId`.
async function asTenant<T>(
  companyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
    return fn(tx);
  });
}

describe('tenant isolation (Sprint 3 non-negotiable)', () => {
  let A: Seeded;
  let B: Seeded;

  beforeAll(async () => {
    if (!OWNER_URL) throw new Error('DATABASE_URL not set');
    A = await seedCompany('A');
    B = await seedCompany('B');
  });

  afterAll(async () => {
    if (B) await deleteCompany(B).catch(() => undefined);
    if (A) await deleteCompany(A).catch(() => undefined);
    await ownerDb.$disconnect();
    await appDb.$disconnect();
  });

  describe('with tenant context A', () => {
    it('sees its own rows', async () => {
      const result = await asTenant(A.companyId, async (tx) => ({
        company: await tx.company.findUnique({ where: { id: A.companyId } }),
        branch: await tx.branch.findUnique({ where: { id: A.branchId } }),
        user: await tx.user.findUnique({ where: { id: A.userId } }),
      }));
      expect(result.company?.id).toBe(A.companyId);
      expect(result.branch?.id).toBe(A.branchId);
      expect(result.user?.id).toBe(A.userId);
    });

    it('returns null for B.company.id (RLS hides it)', async () => {
      const row = await asTenant(A.companyId, (tx) =>
        tx.company.findUnique({ where: { id: B.companyId } }),
      );
      expect(row).toBeNull();
    });

    it('returns null for B.branch.id', async () => {
      const row = await asTenant(A.companyId, (tx) =>
        tx.branch.findUnique({ where: { id: B.branchId } }),
      );
      expect(row).toBeNull();
    });

    it('returns null for B.department.id', async () => {
      const row = await asTenant(A.companyId, (tx) =>
        tx.department.findUnique({ where: { id: B.departmentId } }),
      );
      expect(row).toBeNull();
    });

    it('returns null for B.user.id', async () => {
      const row = await asTenant(A.companyId, (tx) =>
        tx.user.findUnique({ where: { id: B.userId } }),
      );
      expect(row).toBeNull();
    });

    it('cannot leak B existence: a random UUID and B.user.id both return null', async () => {
      const result = await asTenant(A.companyId, async (tx) => ({
        bUser: await tx.user.findUnique({ where: { id: B.userId } }),
        randomUser: await tx.user.findUnique({ where: { id: randomUUID() } }),
      }));
      expect(result.bUser).toBeNull();
      expect(result.randomUser).toBeNull();
    });

    it('cannot UPDATE B.branch (RLS hides it from updateMany affectedRows)', async () => {
      const affected = await asTenant(A.companyId, (tx) =>
        tx.branch.updateMany({
          where: { id: B.branchId },
          data: { name: 'hijacked-by-A' },
        }),
      );
      expect(affected.count).toBe(0);
      // And the row is unchanged from B's perspective (verify via owner client):
      const unchanged = await ownerDb.branch.findUnique({ where: { id: B.branchId } });
      expect(unchanged?.name).toBe(`Branch-B`);
    });

    it('cannot INSERT a branch into B (RLS WITH CHECK rejects)', async () => {
      await expect(
        asTenant(A.companyId, (tx) =>
          tx.branch.create({ data: { companyId: B.companyId, name: 'spoofed' } }),
        ),
      ).rejects.toThrow();
      // And no orphan landed in B:
      const branches = await ownerDb.branch.findMany({
        where: { companyId: B.companyId, name: 'spoofed' },
      });
      expect(branches).toHaveLength(0);
    });
  });
});
