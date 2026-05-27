-- Sprint 10.6: business-day calendar inputs.
--
-- working_days is a bitmask: bit 0 = Sunday … bit 6 = Saturday. So 0b0011111
-- (decimal 31) means Sun–Thu are working (the typical Iraq workweek; Fri+Sat
-- are the weekend). The default mirrors the blueprint's MENA assumption.
--
-- holidays carries per-company (or per-branch override) non-working days.
-- A NULL branch_id means "all branches in this company"; a specific branch_id
-- adds a local holiday (e.g., a branch in Erbil observing Newroz that a
-- Baghdad branch does not).
--
-- users.leave_start_date / leave_end_date is the simplest representation of
-- approved leave: a contiguous date range. When per-day leave or partial-day
-- leave lands, we'll likely move to a dedicated user_leave table (a follow-up
-- — flagged in project_followups.md).

ALTER TABLE "companies"
  ADD COLUMN "working_days" smallint NOT NULL DEFAULT 31;

ALTER TABLE "branches"
  ADD COLUMN "working_days" smallint;
-- NULL on branches.working_days means "inherit from company." Only override
-- when a branch deviates (rare).

CREATE TABLE "holidays" (
  "id"          uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"  uuid           NOT NULL,
  "branch_id"   uuid,
  "date"        date           NOT NULL,
  "name"        text           NOT NULL,
  "created_at"  timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at"  timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at"  timestamptz(6),
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holidays_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE Cascade,
  CONSTRAINT "holidays_branch_id_fkey"
    FOREIGN KEY ("branch_id")  REFERENCES "branches"("id")  ON DELETE Cascade
);

CREATE INDEX "idx_holidays_company_date"
  ON "holidays" ("company_id", "date")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_holidays_branch_date"
  ON "holidays" ("branch_id", "date")
  WHERE deleted_at IS NULL AND branch_id IS NOT NULL;

-- RLS — same pattern as branches/etc.
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays_tenant_isolation" ON "holidays"
  USING (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "holidays" TO app_user;

-- updated_at maintained by the existing global trigger; explicit attach here
-- so a stray migration drop wouldn't silently break it. The function was
-- defined back in the initial schema migration.
CREATE TRIGGER trg_holidays_set_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Approved leave window on users. A null pair means "no current leave."
ALTER TABLE "users"
  ADD COLUMN "leave_start_date" date,
  ADD COLUMN "leave_end_date"   date;

-- A small index for the calendar query "is user on leave on date D?"
CREATE INDEX "idx_users_leave_window"
  ON "users" ("id")
  WHERE leave_start_date IS NOT NULL;
