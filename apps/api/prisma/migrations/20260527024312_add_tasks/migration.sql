-- Sprint 8 task 8.1: tasks table per blueprint §5.10 + §5.28 indexes.
-- Note: assignee_count and reassignment_request_count are denormalized
-- counters maintained by Sprint 9–10 transitions. parent_task_id is on the
-- schema even though subtasks are Phase 1.5 — saves a future migration.

CREATE TABLE "tasks" (
  "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"                  UUID NOT NULL,
  "branch_id"                   UUID,
  "department_id"               UUID NOT NULL,
  "team_id"                     UUID,
  "parent_task_id"              UUID
                                  REFERENCES "tasks"("id") ON DELETE RESTRICT,

  "title"                       TEXT NOT NULL,
  "description"                 TEXT,

  "status"                      "task_status"   NOT NULL DEFAULT 'draft',
  "priority"                    "task_priority" NOT NULL DEFAULT 'medium',

  "created_by_user_id"          UUID NOT NULL,
  "assigned_to_user_id"         UUID,
  "assignee_count"              INT  NOT NULL DEFAULT 0,
  "reassignment_request_count"  INT  NOT NULL DEFAULT 0,

  "due_date"                    DATE,
  "started_at"                  TIMESTAMPTZ(6),
  "completed_at"                TIMESTAMPTZ(6),

  "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "deleted_at"                  TIMESTAMPTZ(6)
);

-- §5.28 indexes. The general pattern: company_id is always part of multi-
-- column indexes because RLS filters every query by it, and Postgres can
-- only use one index per scan — so a leading company_id keeps lookups fast.

CREATE INDEX "idx_tasks_company_deleted"   ON "tasks" ("company_id", "deleted_at");
CREATE INDEX "idx_tasks_company_status"    ON "tasks" ("company_id", "status");
CREATE INDEX "idx_tasks_company_assignee"  ON "tasks" ("company_id", "assigned_to_user_id");
CREATE INDEX "idx_tasks_company_creator"   ON "tasks" ("company_id", "created_by_user_id");
CREATE INDEX "idx_tasks_department"        ON "tasks" ("department_id");
CREATE INDEX "idx_tasks_team"              ON "tasks" ("team_id");
CREATE INDEX "idx_tasks_parent"            ON "tasks" ("parent_task_id");
CREATE INDEX "idx_tasks_company_due_date"  ON "tasks" ("company_id", "due_date");

-- RLS — same pattern as every other tenant-scoped table.
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tasks_tenant_isolation" ON "tasks"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- DML grants for app_user.
GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks" TO app_user;

-- updated_at trigger (matches the Sprint 2.8 pattern across other tables).
CREATE TRIGGER "tasks_set_updated_at"
  BEFORE UPDATE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
