-- Sprint 8 task 8.3: task_reassignment_requests (blueprint §5.12, new in v2.0).
-- Flow: assignee can't do the task → opens a reassignment request → creator
-- or manager approves/rejects. tasks.reassignment_request_count (8.1) tracks
-- the lifetime count; this table tracks each request's state.
--
-- company_id is denormalized onto this table (rather than derived via the
-- tasks join) so RLS is one indexed comparison and tenant-scoped queries
-- ("all my pending requests") don't need a join. Same trade-off task_tags
-- and tasks themselves make.

CREATE TABLE "task_reassignment_requests" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"              UUID NOT NULL,
  "task_id"                 UUID NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "requested_by_user_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requested_to_user_id"    UUID         REFERENCES "users"("id") ON DELETE SET NULL,
  "reason"                  TEXT,
  "status"                  TEXT NOT NULL DEFAULT 'pending',
  "decided_by_user_id"      UUID         REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at"              TIMESTAMPTZ(6),
  "decision_note"           TEXT,
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_task_reassignment_requests_company_status"
  ON "task_reassignment_requests" ("company_id", "status");
CREATE INDEX "idx_task_reassignment_requests_task"
  ON "task_reassignment_requests" ("task_id");
CREATE INDEX "idx_task_reassignment_requests_requested_by"
  ON "task_reassignment_requests" ("requested_by_user_id");

-- Only one pending request per task — partial unique index.
-- Matches the same pattern as user_invitation_approvals (§7.3).
CREATE UNIQUE INDEX "idx_task_reassignment_requests_one_pending_per_task"
  ON "task_reassignment_requests" ("task_id") WHERE "status" = 'pending';

ALTER TABLE "task_reassignment_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_reassignment_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "task_reassignment_requests_tenant_isolation" ON "task_reassignment_requests"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_reassignment_requests" TO app_user;

CREATE TRIGGER "task_reassignment_requests_set_updated_at"
  BEFORE UPDATE ON "task_reassignment_requests"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
