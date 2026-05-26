-- Sprint 7 task 7.1: company_settings (1:1 with companies).
-- Per blueprint §5.24. One JSONB column per setting (not one giant blob) so
-- queries stay cheap and individual settings can grow indexes if needed.
-- More settings will land in future sprints (notification prefs, fiscal year,
-- etc.) — add columns here as they're needed.

CREATE TABLE "company_settings" (
  "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"                  UUID NOT NULL UNIQUE
                                  REFERENCES "companies"("id") ON DELETE CASCADE,
  "onboarding_approval_chain"   JSONB NOT NULL DEFAULT '["supervisor","manager"]'::jsonb,
  "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "deleted_at"                  TIMESTAMPTZ(6)
);

-- RLS — same pattern as branches/teams/etc.
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "company_settings_tenant_isolation" ON "company_settings"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- DML grants for app_user (the no-BYPASSRLS runtime role).
GRANT SELECT, INSERT, UPDATE, DELETE ON "company_settings" TO app_user;

-- updated_at trigger so app code doesn't have to set it manually.
CREATE TRIGGER "company_settings_set_updated_at"
  BEFORE UPDATE ON "company_settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: ensure every existing tenant has a settings row.
INSERT INTO "company_settings" ("company_id")
SELECT "id" FROM "companies" WHERE "deleted_at" IS NULL
ON CONFLICT ("company_id") DO NOTHING;
