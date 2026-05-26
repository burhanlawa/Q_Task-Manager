-- Sprint 8 task 8.2: task_assignees join + assignee_count trigger.
-- Per blueprint §5.11 + v2.0 denormalized tasks.assignee_count.
--
-- tasks.assigned_to_user_id stays as the *primary* assignee (UX concept,
-- "main owner"). task_assignees tracks all participants. The trigger keeps
-- tasks.assignee_count in sync with the join table so list queries can
-- filter/sort by it without a subquery.

CREATE TABLE "task_assignees" (
  "task_id"               UUID NOT NULL REFERENCES "tasks"("id")  ON DELETE CASCADE,
  "user_id"               UUID NOT NULL REFERENCES "users"("id")  ON DELETE CASCADE,
  "assigned_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "assigned_by_user_id"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
  PRIMARY KEY ("task_id", "user_id")
);

CREATE INDEX "idx_task_assignees_user"  ON "task_assignees" ("user_id");

-- RLS via the join to tasks. We can't reference current_setting directly on a
-- join-only table — the policy checks via a subquery on tasks.company_id.
-- This is the same pattern user_teams would use (we didn't add RLS there
-- because join tables to user_id are implicitly scoped via users.company_id;
-- task_assignees ties to tasks which carries company_id explicitly).
ALTER TABLE "task_assignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_assignees" FORCE ROW LEVEL SECURITY;
CREATE POLICY "task_assignees_tenant_isolation" ON "task_assignees"
  USING (
    EXISTS (
      SELECT 1 FROM "tasks" t
      WHERE t."id" = "task_assignees"."task_id"
        AND t."company_id" = current_setting('app.current_company_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "tasks" t
      WHERE t."id" = "task_assignees"."task_id"
        AND t."company_id" = current_setting('app.current_company_id', true)::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_assignees" TO app_user;

-- Counter-maintaining trigger. Recomputes assignee_count for the affected
-- task on every row change. AFTER INSERT/DELETE so the count reflects post-
-- change reality. Bulk delete fires the trigger per row but each fire
-- recomputes from scratch — correct, slightly wasteful, fine at our scale.
CREATE OR REPLACE FUNCTION update_task_assignee_count() RETURNS TRIGGER AS $$
DECLARE
  affected_task_id UUID;
BEGIN
  -- OLD is set on DELETE, NEW on INSERT. Coalesce picks whichever is present.
  affected_task_id := COALESCE(NEW.task_id, OLD.task_id);
  UPDATE "tasks"
  SET "assignee_count" = (
    SELECT COUNT(*) FROM "task_assignees" WHERE "task_id" = affected_task_id
  )
  WHERE "id" = affected_task_id;
  RETURN NULL; -- AFTER trigger, return value ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_assignees_count_after_insert"
  AFTER INSERT ON "task_assignees"
  FOR EACH ROW EXECUTE FUNCTION update_task_assignee_count();

CREATE TRIGGER "task_assignees_count_after_delete"
  AFTER DELETE ON "task_assignees"
  FOR EACH ROW EXECUTE FUNCTION update_task_assignee_count();
