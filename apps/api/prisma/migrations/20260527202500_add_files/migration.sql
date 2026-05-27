-- Sprint 11.1: files table for R2-backed uploads.
--
-- One row per uploaded asset. Created in 'not_scanned' state when the
-- pre-signed upload URL is issued; the antivirus pipeline (later) flips
-- it to 'pending' while scanning then 'clean' / 'infected' / 'error'.
--
-- r2_key is the object path inside the bucket. The convention enforced
-- in code is "{company_id}/{file_id}/{filename}" — embedding company_id
-- in the key gives a structural cross-tenant barrier even if RLS were
-- to fail open (defense in depth).
--
-- Polymorphic owner_id + owner_type lets one file row hang off a task,
-- a user (avatar), a company (logo), etc. without a forest of nullable
-- FK columns. The (owner_type, owner_id) index makes "list files for X"
-- a fast lookup.

-- The 'not_scanned' enum value was added in the immediately preceding
-- migration (Postgres needs new enum values committed in their own
-- transaction before they can be used as a column DEFAULT).

CREATE TABLE "files" (
  "id"                uuid                NOT NULL DEFAULT gen_random_uuid(),
  "company_id"        uuid                NOT NULL,
  "uploader_user_id"  uuid                NOT NULL,

  -- What kind of asset this is. Drives authorization (who can read) and
  -- placement (avatars vs task attachments live under different prefixes).
  "purpose"           file_purpose        NOT NULL,

  -- Polymorphic owner. owner_type is a short string ('task','user',
  -- 'company') and owner_id refers to that table's row. NULL on both
  -- means an orphaned upload — possible during the upload-url → confirm
  -- gap, but should never be the steady state.
  "owner_type"        text,
  "owner_id"          uuid,

  -- The object key inside the R2 bucket. Unique per bucket so an index
  -- on it is naturally tenant-isolated when keys start with company_id.
  "r2_key"            text                NOT NULL,

  -- User-visible original filename. NEVER use this to build the r2_key —
  -- the server generates the key with a UUID to avoid path injection.
  "original_filename" text                NOT NULL,
  "content_type"      text                NOT NULL,
  "size_bytes"        bigint              NOT NULL,

  -- Upload lifecycle. 'pending_upload' = pre-signed URL issued, client
  -- hasn't confirmed yet. 'uploaded' = confirmed. 'failed' = client
  -- aborted or the confirm step rejected. Pure status field; the AV
  -- column below tracks the scan separately.
  "upload_status"     text                NOT NULL DEFAULT 'pending_upload',

  "virus_scan_status" virus_scan_status   NOT NULL DEFAULT 'not_scanned',

  "created_at"        timestamptz(6)      NOT NULL DEFAULT now(),
  "updated_at"        timestamptz(6)      NOT NULL DEFAULT now(),
  "deleted_at"        timestamptz(6),

  CONSTRAINT "files_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "files_r2_key_unique"   UNIQUE ("r2_key"),
  CONSTRAINT "files_company_id_fkey"
    FOREIGN KEY ("company_id")       REFERENCES "companies"("id") ON DELETE Restrict,
  CONSTRAINT "files_uploader_user_id_fkey"
    FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id")     ON DELETE Restrict,
  CONSTRAINT "files_size_positive"
    CHECK (size_bytes >= 0)
);

CREATE INDEX "idx_files_company_id"
  ON "files" ("company_id")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_files_company_purpose"
  ON "files" ("company_id", "purpose")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_files_owner"
  ON "files" ("owner_type", "owner_id")
  WHERE deleted_at IS NULL AND owner_id IS NOT NULL;
CREATE INDEX "idx_files_uploader"
  ON "files" ("uploader_user_id")
  WHERE deleted_at IS NULL;

-- RLS — same shape as other tenant-scoped tables.
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;

CREATE POLICY "files_tenant_isolation" ON "files"
  USING (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "files" TO app_user;

-- updated_at maintained by the existing set_updated_at() function.
CREATE TRIGGER trg_files_set_updated_at
  BEFORE UPDATE ON "files"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
