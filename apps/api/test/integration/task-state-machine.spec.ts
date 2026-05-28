import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ActivityLogService } from '../../src/activity-log/activity-log.service';
import { PermissionsService } from '../../src/auth/permissions.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { TaskReassignmentController } from '../../src/tasks/task-reassignment.controller';
import { TaskTransitionsController } from '../../src/tasks/task-transitions.controller';
import { TasksController } from '../../src/tasks/tasks.controller';

// Sprint 8.8 — task state machine integration test (non-negotiable).
//
// We instantiate the controllers as plain classes (no Nest HTTP layer) and
// drive them with a real RLS-scoped Prisma transaction. PermissionsService
// is stubbed to return whatever permission set the test wants; the real
// ActivityLogService writes through to verify audit rows.
//
// We seed exactly ONE company with two users: a `manager` (creator) and an
// `employee` (assignee). The matrix below uses these two identities.

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL ?? OWNER_URL;

const ownerDb = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

type Seed = {
  companyId: string;
  branchId: string;
  departmentId: string;
  managerId: string;
  employeeId: string;
};

async function seed(): Promise<Seed> {
  const tag = randomUUID().slice(0, 8);
  const company = await ownerDb.company.create({
    data: { name: `SM-${tag}`, slug: `sm-${tag}`, country: 'IQ' },
  });
  const branch = await ownerDb.branch.create({
    data: { companyId: company.id, name: `B-${tag}` },
  });
  const department = await ownerDb.department.create({
    data: { companyId: company.id, branchId: branch.id, name: `D-${tag}`, isAutoCreated: true },
  });
  const manager = await ownerDb.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      departmentId: department.id,
      email: `mgr-${tag}@sm.test`,
      displayName: 'Manager',
      orgRole: 'ceo',
      status: 'active',
    },
  });
  const employee = await ownerDb.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      departmentId: department.id,
      email: `emp-${tag}@sm.test`,
      displayName: 'Employee',
      orgRole: 'employee',
      status: 'active',
    },
  });
  return {
    companyId: company.id,
    branchId: branch.id,
    departmentId: department.id,
    managerId: manager.id,
    employeeId: employee.id,
  };
}

async function teardown(s: Seed): Promise<void> {
  await ownerDb.activityLog.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.taskReassignmentRequest.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.taskAssignee.deleteMany({ where: { task: { companyId: s.companyId } } });
  await ownerDb.task.deleteMany({ where: { companyId: s.companyId } });
  await ownerDb.user.deleteMany({ where: { companyId: s.companyId } });
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
    // Sprint 14.1 added per-recipient RLS bound to app.current_user_id.
    // Bind a placeholder when the caller didn't pass one — the RLS policy
    // on notifications would otherwise blow up with "" when current_setting
    // returns the empty default. Real tenant-scoped tables (the only ones
    // these tests touch outside of notifications) don't read this var, so
    // any UUID works as the placeholder.
    if (userId) {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000000', true)`;
    }
    return fn(tx);
  });
}

// Stub PermissionsService — gives every user the wildcard so the role gate
// short-circuits and the real per-action checks (creator/assignee) are what
// we exercise here.
function stubPerms(): PermissionsService {
  return {
    getEffectivePermissions: async () => new Set(['*']),
    has: (granted: Set<string>, key: string) => granted.has('*') || granted.has(key),
  } as unknown as PermissionsService;
}

// Real ActivityLogService — verifying log rows is part of the done check.
const activity = new ActivityLogService();
const calendar = new CalendarService();
// PusherService reads PUSHER_* env vars; in tests we just want a no-op trigger.
// new PusherService() with the env vars present would actually attempt to call
// Pusher's REST API on every notification write, which spams real traffic.
// Stub PusherService + EmailTemplateService + BullMQ Queue. The test asserts
// notification ROW writes (the contract); the Pusher trigger and email
// enqueue are fire-and-forget side-effects that don't change those rows.
const notifications = new NotificationsService(
  { safeTrigger: async () => {} } as never,
  { render: () => ({ subject: '', html: '', text: '' }) } as never,
  { add: async () => ({ id: 'stub' }) } as never,
);

// Controller instances (recreated per test in case state ever creeps in).
function makeControllers() {
  const perms = stubPerms();
  return {
    tasks: new TasksController(perms, activity, calendar, notifications),
    transitions: new TaskTransitionsController(perms, activity, notifications),
    reassign: new TaskReassignmentController(perms, activity, notifications),
  };
}

describe('task state machine (Sprint 8 non-negotiable)', () => {
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

  // Helper: create a fresh task assigned to employee, returning its id and
  // the manager tenant for the subsequent transition calls.
  async function newAssignedTask(): Promise<string> {
    const c = makeControllers();
    const t = await asTenant(s.companyId, (tx) =>
      c.tasks.create(
        tx,
        { companyId: s.companyId, userId: s.managerId },
        {
          title: `t-${randomUUID().slice(0, 6)}`,
          departmentId: s.departmentId,
          assigneeUserIds: [s.employeeId],
        },
      ),
    );
    return (t as { id: string }).id;
  }

  // -------- happy paths --------

  describe('happy paths', () => {
    it('draft → assigned (created with assignees)', async () => {
      const id = await newAssignedTask();
      const row = await ownerDb.task.findUnique({ where: { id }, select: { status: true } });
      expect(row?.status).toBe('assigned');
    });

    it('create without assignees → draft', async () => {
      const c = makeControllers();
      const task = await asTenant(s.companyId, (tx) =>
        c.tasks.create(
          tx,
          { companyId: s.companyId, userId: s.managerId },
          { title: 'no-assignees', departmentId: s.departmentId },
        ),
      );
      expect((task as { status: string }).status).toBe('draft');
    });

    it('assigned → in_progress (accept)', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.accept(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      expect((row as { status: string }).status).toBe('in_progress');
    });

    it('assigned → in_progress (start)', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      expect((row as { status: string }).status).toBe('in_progress');
    });

    it('in_progress → submitted', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.submit(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      expect((row as { status: string }).status).toBe('submitted');
    });

    it('submitted → completed (approve)', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.transitions.submit(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.approve(tx, { companyId: s.companyId, userId: s.managerId }, id, {}),
      );
      expect((row as { status: string }).status).toBe('completed');
    });

    it('submitted → in_progress (request-revision)', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.transitions.submit(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.requestRevision(
          tx,
          { companyId: s.companyId, userId: s.managerId },
          id,
          { note: 'tweak X' },
        ),
      );
      expect((row as { status: string }).status).toBe('in_progress');
    });

    it('any non-terminal → cancelled (creator cancels assigned)', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      const row = await asTenant(s.companyId, (tx) =>
        c.transitions.cancel(tx, { companyId: s.companyId, userId: s.managerId }, id, {}),
      );
      expect((row as { status: string }).status).toBe('cancelled');
    });

    it('reassignment-approved: status → draft, assignees cleared', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.reassign.request(
          tx,
          { companyId: s.companyId, userId: s.employeeId },
          id,
          { reason: 'wrong skillset' },
        ),
      );
      const out = await asTenant(s.companyId, (tx) =>
        c.reassign.decide(
          tx,
          { companyId: s.companyId, userId: s.managerId },
          id,
          { decision: 'approved' as never },
        ),
      );
      expect((out as { task: { status: string; assignees: unknown[] } }).task.status).toBe('draft');
      expect((out as { task: { assignees: unknown[] } }).task.assignees).toHaveLength(0);
      const dbRow = await ownerDb.task.findUnique({
        where: { id },
        select: { assignedToUserId: true, assigneeCount: true },
      });
      expect(dbRow?.assignedToUserId).toBeNull();
      expect(dbRow?.assigneeCount).toBe(0);
    });

    it('reassignment-rejected: status restored to previous', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      // Move to in_progress so we can assert restore to in_progress (not just assigned).
      await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.reassign.request(
          tx,
          { companyId: s.companyId, userId: s.employeeId },
          id,
          { reason: 'still want different scope' },
        ),
      );
      const out = await asTenant(s.companyId, (tx) =>
        c.reassign.decide(
          tx,
          { companyId: s.companyId, userId: s.managerId },
          id,
          { decision: 'rejected' as never, note: 'push through' },
        ),
      );
      expect((out as { task: { status: string } }).task.status).toBe('in_progress');
    });
  });

  // -------- forbidden transitions (409) --------

  // For each pair (from, to) that is NOT in the allowed set we drive a task
  // into `from` and assert calling the `to` endpoint throws ConflictException.
  // We pre-position the task into each starting state via the owner client
  // (RLS-bypassing) so we can probe transitions without re-deriving them.

  async function setStatus(taskId: string, status: string): Promise<void> {
    await ownerDb.task.update({
      where: { id: taskId },
      data: { status: status as never },
    });
  }

  describe('forbidden transitions return 409', () => {
    let id: string;
    const tx = (userId: string) => ({ companyId: s.companyId, userId });

    beforeEach(async () => {
      id = await newAssignedTask();
    });

    afterEach(async () => {
      // Best-effort cleanup so each test starts clean.
      await ownerDb.activityLog.deleteMany({ where: { targetId: id } });
      await ownerDb.taskReassignmentRequest.deleteMany({ where: { taskId: id } });
      await ownerDb.taskAssignee.deleteMany({ where: { taskId: id } });
      await ownerDb.task.delete({ where: { id } });
    });

    it('cannot accept from in_progress, submitted, completed, cancelled', async () => {
      const c = makeControllers();
      for (const status of ['in_progress', 'submitted', 'completed', 'cancelled']) {
        await setStatus(id, status);
        await expect(
          asTenant(s.companyId, (db) =>
            c.transitions.accept(db, tx(s.employeeId), id, {}),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot submit unless in_progress', async () => {
      const c = makeControllers();
      for (const status of ['draft', 'assigned', 'submitted', 'completed', 'cancelled']) {
        await setStatus(id, status);
        // Need a fresh assignee row for 'draft' (assignees may be intact since
        // we never approved; status doesn't change task_assignees).
        await expect(
          asTenant(s.companyId, (db) =>
            c.transitions.submit(db, tx(s.employeeId), id, {}),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot approve unless submitted', async () => {
      const c = makeControllers();
      for (const status of [
        'draft',
        'assigned',
        'in_progress',
        'reassignment_requested',
        'completed',
        'cancelled',
      ]) {
        await setStatus(id, status);
        await expect(
          asTenant(s.companyId, (db) =>
            c.transitions.approve(db, tx(s.managerId), id, {}),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot request-revision unless submitted', async () => {
      const c = makeControllers();
      for (const status of [
        'draft',
        'assigned',
        'in_progress',
        'reassignment_requested',
        'completed',
        'cancelled',
      ]) {
        await setStatus(id, status);
        await expect(
          asTenant(s.companyId, (db) =>
            c.transitions.requestRevision(db, tx(s.managerId), id, {}),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot cancel a terminal task (completed/cancelled)', async () => {
      const c = makeControllers();
      for (const status of ['completed', 'cancelled']) {
        await setStatus(id, status);
        await expect(
          asTenant(s.companyId, (db) =>
            c.transitions.cancel(db, tx(s.managerId), id, {}),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot request-reassignment unless assigned or in_progress', async () => {
      const c = makeControllers();
      for (const status of [
        'draft',
        'submitted',
        'reassignment_requested',
        'completed',
        'cancelled',
      ]) {
        await setStatus(id, status);
        await expect(
          asTenant(s.companyId, (db) =>
            c.reassign.request(db, tx(s.employeeId), id, { reason: 'x' }),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('cannot decide reassignment without a pending request', async () => {
      const c = makeControllers();
      // task is 'assigned', no pending request → NotFound
      await expect(
        asTenant(s.companyId, (db) =>
          c.reassign.decide(db, tx(s.managerId), id, { decision: 'approved' as never }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------- role gates --------

  describe('role gates', () => {
    it('non-assignee cannot accept/start/submit', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      // manager is creator (not assignee)
      await expect(
        asTenant(s.companyId, (tx) =>
          c.transitions.accept(tx, { companyId: s.companyId, userId: s.managerId }, id, {}),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('non-creator without task.approve cannot approve', async () => {
      const id = await newAssignedTask();
      // Drive to submitted as employee
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.transitions.start(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.transitions.submit(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      // Build a controller with EMPTY perms set so employee (non-creator) fails.
      const emptyPerms = {
        getEffectivePermissions: async () => new Set<string>(),
        has: (g: Set<string>, k: string) => g.has(k),
      } as unknown as PermissionsService;
      const guarded = new TaskTransitionsController(emptyPerms, activity, notifications);
      await expect(
        asTenant(s.companyId, (tx) =>
          guarded.approve(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------- activity log --------

  describe('activity log', () => {
    it('records each transition with from/to', async () => {
      const id = await newAssignedTask();
      const c = makeControllers();
      await asTenant(s.companyId, (tx) =>
        c.transitions.accept(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.transitions.submit(tx, { companyId: s.companyId, userId: s.employeeId }, id, {}),
      );
      await asTenant(s.companyId, (tx) =>
        c.transitions.approve(tx, { companyId: s.companyId, userId: s.managerId }, id, {}),
      );
      const logs = await ownerDb.activityLog.findMany({
        where: { targetId: id, actionType: { startsWith: 'task_' } },
        orderBy: { createdAt: 'asc' },
        select: { actionType: true, metadata: true },
      });
      const types = logs.map((l) => l.actionType);
      expect(types).toEqual(
        expect.arrayContaining(['task_created', 'task_accepted', 'task_submitted', 'task_approved']),
      );
      const approve = logs.find((l) => l.actionType === 'task_approved');
      expect((approve?.metadata as { from?: string }).from).toBe('submitted');
      expect((approve?.metadata as { to?: string }).to).toBe('completed');
    });
  });
});
