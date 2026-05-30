// Sprint 21.4 — End-to-end critical-paths suite.
//
// The blueprint asks for Playwright, but a true browser-driven test
// would need to round-trip through Clerk's hosted signup form and a
// real Paddle/Stripe sandbox — neither of which is reachable from CI
// today (Iraq jurisdiction blocker logged in followups). Instead we
// drive the same workflow at the API layer through the controllers,
// which gives the equivalent integration coverage without the
// browser + Clerk + provider dependencies.
//
// What this suite gates:
//   1. Tenant + founder CEO seeded (the "signup" step, minus Clerk).
//   2. CEO invites an employee → user.create + activity log row.
//   3. CEO creates a task with the employee as the assignee.
//   4. Employee accepts → starts → submits.
//   5. CEO approves → task transitions to completed.
//   6. Bank-transfer invoice generated → reference submitted →
//      operator marks paid → subscription flips to active+growth.
//
// Steps 1 + 6 use the deferred substitutes we built earlier:
//   - "Signup" = direct ownerDb.user.create (no Clerk fan-out).
//   - "Invoice paid" = the manual bank-transfer flow from Sprint 20.4,
//     which doesn't need an external provider. The 'card' path through
//     Paddle/Stripe is logged as a followup.

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ActivityLogService } from '../../src/activity-log/activity-log.service';
import { PermissionsService } from '../../src/auth/permissions.service';
import { BankTransferService } from '../../src/billing/bank-transfer.service';
import { PlanLimitsService } from '../../src/billing/plan-limits.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { TaskTransitionsController } from '../../src/tasks/task-transitions.controller';
import { TasksController } from '../../src/tasks/tasks.controller';
import { UsersService } from '../../src/users/users.service';

// Silence the unused-import linter — these are the exception types the
// controller methods throw, present here so future assertions can
// import them without re-editing.
void ConflictException;
void ForbiddenException;
void NotFoundException;

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL ?? OWNER_URL;

const ownerDb = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

type Seed = {
  companyId: string;
  branchId: string;
  departmentId: string;
  subscriptionId: string;
  ceoUserId: string;
};

async function seed(): Promise<Seed> {
  const tag = randomUUID().slice(0, 8);
  const company = await ownerDb.company.create({
    data: { name: `E2E-${tag}`, slug: `e2e-${tag}`, country: 'IQ' },
  });
  const branch = await ownerDb.branch.create({
    data: { companyId: company.id, name: 'Main' },
  });
  const department = await ownerDb.department.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      name: 'Executive',
      isAutoCreated: true,
    },
  });
  const ceo = await ownerDb.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      departmentId: department.id,
      email: `ceo-${tag}@e2e.test`,
      displayName: 'CEO',
      orgRole: 'ceo',
      status: 'active',
    },
  });
  // Same shape the Sprint 19.1 backfill + clerk-webhook signup create.
  const subscription = await ownerDb.subscription.create({
    data: {
      companyId: company.id,
      plan: 'starter',
      status: 'trialing',
      billingCycle: 'monthly',
      paymentProvider: 'paddle',
      trialEndAt: new Date(Date.now() + 14 * 86_400_000),
    },
  });
  return {
    companyId: company.id,
    branchId: branch.id,
    departmentId: department.id,
    subscriptionId: subscription.id,
    ceoUserId: ceo.id,
  };
}

async function teardown(s: Seed): Promise<void> {
  await ownerDb.activityLog.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.invoice.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.task.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.userInvitationApproval.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.user.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.subscription.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.department.delete({ where: { id: s.departmentId } });
  await ownerDb.branch.delete({ where: { id: s.branchId } });
  await ownerDb.company.delete({ where: { id: s.companyId } });
}

async function asTenant<T>(
  companyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId ?? '00000000-0000-0000-0000-000000000000'}, true)`;
    return fn(tx);
  });
}

// Stubs — same pattern as the task-state-machine spec.
function stubPerms(): PermissionsService {
  return {
    getEffectivePermissions: async () => new Set(['*']),
    has: (granted: Set<string>, key: string) => granted.has('*') || granted.has(key),
  } as unknown as PermissionsService;
}

// Clerk stub for the invite path — UsersService calls
// clerk.invitations.createInvitation; we just record what would've
// been sent and return an id. Real Clerk testing requires production
// app + a foreign jurisdiction; out of scope for CI.
function stubClerk() {
  return {
    invitations: {
      createInvitation: async () => ({ id: `clerk_inv_${randomUUID().slice(0, 8)}` }),
    },
  } as never;
}

const activity = new ActivityLogService();
const calendar = new CalendarService();
const notifications = new NotificationsService(
  { safeTrigger: async () => {} } as never,
  { render: () => ({ subject: '', html: '', text: '' }) } as never,
  { add: async () => ({ id: 'stub' }) } as never,
);
const planLimits = new PlanLimitsService();

// Bank-transfer service needs an admin client. Use ownerDb (the same
// connection the service would normally get injected). Real R2 isn't
// touched by the markPaid path.
const bankTransfer = new BankTransferService(ownerDb as never);

// Bank-transfer service refuses to mint invoices if BANK_TRANSFER_*
// envs aren't set. Inject placeholders so the createPendingInvoice
// path is exercisable in CI.
process.env.BANK_TRANSFER_ACCOUNT_NAME ??= 'CI Bank';
process.env.BANK_TRANSFER_BANK_NAME ??= 'CI Test Bank';
process.env.BANK_TRANSFER_IBAN ??= 'IQ00CI00000000000000000000';
process.env.BANK_TRANSFER_SWIFT ??= 'CIBKIQBA';

const usersService = new UsersService(stubClerk(), activity, planLimits);

function makeTaskControllers() {
  const perms = stubPerms();
  return {
    tasks: new TasksController(perms, activity, calendar, notifications),
    transitions: new TaskTransitionsController(perms, activity, notifications),
  };
}

describe('critical paths (Sprint 21.4 e2e)', () => {
  let s: Seed;

  beforeAll(async () => {
    if (!OWNER_URL) throw new Error('DATABASE_URL not set');
    s = await seed();
  });

  afterAll(async () => {
    if (s) await teardown(s).catch(() => undefined);
    await ownerDb.$disconnect();
    await appDb.$disconnect();
  });

  it('runs the full signup → invite → task → invoice paid workflow', async () => {
    // ── Step 1: tenant exists with CEO (the seeded "signup") ────
    const company = await ownerDb.company.findUnique({ where: { id: s.companyId } });
    expect(company?.status).toBe('trialing');
    const sub = await ownerDb.subscription.findUnique({
      where: { id: s.subscriptionId },
    });
    expect(sub?.plan).toBe('starter');
    expect(sub?.status).toBe('trialing');

    // ── Step 2: CEO invites an employee ─────────────────────────
    const inviteResult = await asTenant(
      s.companyId,
      (tx) =>
        usersService.inviteToTenant(tx, s.companyId, s.ceoUserId, 'ceo', {
          email: `emp-${randomUUID().slice(0, 8)}@e2e.test`,
          firstName: 'Emp',
          lastName: 'Loyee',
          orgRole: 'employee',
          branchId: s.branchId,
          departmentId: s.departmentId,
        } as never),
      s.ceoUserId,
    );
    // CEO invites bypass the approval chain → result.kind = 'invited'.
    expect(inviteResult.kind).toBe('invited');
    const employeeId = inviteResult.userId;
    expect(typeof employeeId).toBe('string');

    // Activity log records the invite.
    const inviteLogs = await ownerDb.activityLog.findMany({
      where: { companyId: s.companyId, actionType: 'invited' },
    });
    expect(inviteLogs.length).toBeGreaterThanOrEqual(1);

    // Bring the employee to 'active' — in the real flow this happens
    // when Clerk fires user.created. For e2e we flip the row directly
    // so the assignee can act on tasks.
    await ownerDb.user.update({
      where: { id: employeeId },
      data: { status: 'active' },
    });

    // ── Step 3: CEO creates a task assigned to employee ─────────
    const c = makeTaskControllers();
    const task = (await asTenant(
      s.companyId,
      (tx) =>
        c.tasks.create(tx, { companyId: s.companyId, userId: s.ceoUserId }, {
          title: 'Ship Q3 plan',
          departmentId: s.departmentId,
          assigneeUserIds: [employeeId],
        } as never),
      s.ceoUserId,
    )) as { id: string };
    expect(task.id).toBeTruthy();

    // Task lands assigned (single assignee → skipped the pending step).
    const created = await ownerDb.task.findUnique({ where: { id: task.id } });
    expect(['assigned', 'accepted']).toContain(created?.status);

    // ── Step 4: employee accepts → starts → submits ─────────────
    // In our state machine accept and start both move 'assigned' →
    // 'in_progress'; calling accept here is sufficient. (A user could
    // also call start directly with the same effect — they're peer
    // entry points into in_progress.)
    await asTenant(
      s.companyId,
      (tx) =>
        c.transitions.accept(
          tx,
          { companyId: s.companyId, userId: employeeId },
          task.id,
          {} as never,
        ),
      employeeId,
    );
    await asTenant(
      s.companyId,
      (tx) =>
        c.transitions.submit(
          tx,
          { companyId: s.companyId, userId: employeeId },
          task.id,
          {} as never,
        ),
      employeeId,
    );

    const afterSubmit = await ownerDb.task.findUnique({ where: { id: task.id } });
    expect(afterSubmit?.status).toBe('submitted');

    // ── Step 5: CEO approves → task completes ───────────────────
    await asTenant(
      s.companyId,
      (tx) =>
        c.transitions.approve(
          tx,
          { companyId: s.companyId, userId: s.ceoUserId },
          task.id,
          {} as never,
        ),
      s.ceoUserId,
    );
    const afterApprove = await ownerDb.task.findUnique({ where: { id: task.id } });
    expect(afterApprove?.status).toBe('completed');

    // ── Step 6: invoice paid via bank-transfer flow ─────────────
    // Customer creates a pending invoice (CEO-initiated).
    const invoice = await asTenant(
      s.companyId,
      (tx) =>
        bankTransfer.createPendingInvoice(tx, {
          companyId: s.companyId,
          userId: s.ceoUserId,
        }),
      s.ceoUserId,
    );
    expect(invoice.amountCents).toBeGreaterThan(0);

    // Customer submits the wire reference.
    const reference = `WIRE-E2E-${randomUUID().slice(0, 6)}`;
    await asTenant(
      s.companyId,
      (tx) =>
        bankTransfer.submitReference(tx, {
          companyId: s.companyId,
          invoiceId: invoice.id,
          reference,
        }),
      s.ceoUserId,
    );

    // Operator marks paid (the platform-admin endpoint; ALLOW_HARD here
    // means just calling the service — gating is at controller layer).
    await bankTransfer.markPaid({
      invoiceId: invoice.id,
      markerUserId: s.ceoUserId,
    });

    // Invoice + subscription final state.
    const paid = await ownerDb.invoice.findUnique({ where: { id: invoice.id } });
    expect(paid?.status).toBe('paid');
    expect(paid?.paymentReference).toBe(reference);
    expect(paid?.paidAt).not.toBeNull();
    expect(paid?.paidMarkedByUserId).toBe(s.ceoUserId);

    const finalSub = await ownerDb.subscription.findUnique({
      where: { id: s.subscriptionId },
    });
    expect(finalSub?.status).toBe('active');
    expect(finalSub?.plan).toBe('growth');

    const finalCo = await ownerDb.company.findUnique({ where: { id: s.companyId } });
    expect(finalCo?.status).toBe('active');
    expect(finalCo?.plan).toBe('growth');
  });
});
