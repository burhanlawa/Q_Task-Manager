-- Sprint 5 task 5.4: sensitive-field access logging.
-- Adds users.date_of_birth (Date, nullable) and the activity_log table.
-- Partitioning is deferred to Sprint 17; this is the basic table per §5.21.

ALTER TABLE "users" ADD COLUMN "date_of_birth" DATE;

CREATE TABLE "activity_log" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"     UUID NOT NULL,
  "actor_user_id"  UUID,
  "action_type"    TEXT NOT NULL,
  "target_type"    TEXT,
  "target_id"      UUID,
  "field_changed"  TEXT,
  "metadata"       JSONB,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_activity_log_company_created_at"
  ON "activity_log" ("company_id", "created_at" DESC);
CREATE INDEX "idx_activity_log_target"
  ON "activity_log" ("target_type", "target_id", "created_at" DESC);
CREATE INDEX "idx_activity_log_actor"
  ON "activity_log" ("actor_user_id", "created_at" DESC);

-- RLS so app_user only sees their tenant's rows. Same pattern as branches.
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "activity_log_tenant_isolation" ON "activity_log"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- DML grants for app_user (separate role created in 2.7; ALTER DEFAULT grants
-- handled future-table CREATEs, but we GRANT explicitly here in case the
-- defaults policy didn't run on this branch).
GRANT SELECT, INSERT, UPDATE, DELETE ON "activity_log" TO app_user;
