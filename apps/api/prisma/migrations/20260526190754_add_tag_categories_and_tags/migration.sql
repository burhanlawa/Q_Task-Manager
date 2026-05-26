-- Sprint 6 task 6.2: tag categories + tags.
-- Per blueprint §5.14. Schema kept conservative; Sprint 9–10 (tags + due-date
-- logic) will likely add per-tag policy columns. Both tables are RLS-scoped.

CREATE TABLE "tag_categories" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "name"       TEXT NOT NULL,
  "position"   INT  NOT NULL DEFAULT 0,
  "is_builtin" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "idx_tag_categories_company_name"
  ON "tag_categories" ("company_id", "name");
CREATE INDEX "idx_tag_categories_company_position"
  ON "tag_categories" ("company_id", "position");

CREATE TABLE "tags" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"  UUID NOT NULL,
  "category_id" UUID NOT NULL REFERENCES "tag_categories"("id") ON DELETE RESTRICT,
  "name"        TEXT NOT NULL,
  "color"       TEXT,
  "position"    INT  NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "deleted_at"  TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "idx_tags_category_name"
  ON "tags" ("category_id", "name");
CREATE INDEX "idx_tags_company_category_position"
  ON "tags" ("company_id", "category_id", "position");

-- RLS — same pattern as branches/teams/etc.
ALTER TABLE "tag_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tag_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tag_categories_tenant_isolation" ON "tag_categories"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tags_tenant_isolation" ON "tags"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- DML grants for app_user (the no-BYPASSRLS runtime role).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tag_categories" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tags" TO app_user;

-- updated_at trigger so app code doesn't have to set it manually (matches the
-- pattern from Sprint 2.8).
CREATE TRIGGER "tag_categories_set_updated_at"
  BEFORE UPDATE ON "tag_categories"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "tags_set_updated_at"
  BEFORE UPDATE ON "tags"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
