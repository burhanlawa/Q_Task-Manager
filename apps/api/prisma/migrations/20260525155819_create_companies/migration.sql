-- Sprint 2 task 2.2: create the companies table (root tenant).
-- See blueprint §5.1.
-- UUID v4 via gen_random_uuid() (Postgres 15+ built-in). UUID v7 deferred.

CREATE TABLE "companies" (
  "id"                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"               TEXT         NOT NULL,
  "slug"               TEXT         NOT NULL,
  "country"            TEXT         NOT NULL,
  "default_locale"     TEXT         NOT NULL DEFAULT 'en',
  "default_timezone"   TEXT         NOT NULL DEFAULT 'Asia/Baghdad',
  "default_currency"   TEXT         NOT NULL DEFAULT 'IQD',
  "logo_file_id"       UUID,
  "contact_email"      TEXT,
  "contact_phone"      TEXT,
  "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "deleted_at"         TIMESTAMPTZ
);

CREATE UNIQUE INDEX "idx_companies_slug" ON "companies"("slug");
CREATE INDEX "idx_companies_country" ON "companies"("country");
CREATE INDEX "idx_companies_deleted_at" ON "companies"("deleted_at") WHERE "deleted_at" IS NULL;
