-- Sprint 20.9 — data_exports tracking table.
--
-- Each export request gets a row that survives the BullMQ job's
-- lifetime, so the customer can come back later and pick up the
-- download URL. Lifecycle:
--   pending  → job is queued or running
--   ready    → ZIP is in R2 at r2_key; expires_at says when it's deleted
--   failed   → error captured in failure_reason for support
--   expired  → past expires_at; R2 object may already be gone
--
-- Tenant-scoped via RLS. Owner client (BullMQ worker) bypasses the
-- policy. Two indexes: one for the customer's listing of their own
-- exports, one for the cleanup sweep that nukes expired R2 keys.

CREATE TABLE "data_exports" (
  "id"                uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"        uuid           NOT NULL,
  "requested_by_user_id" uuid,
  -- pending | ready | failed | expired
  "status"            text           NOT NULL DEFAULT 'pending',
  "r2_key"            text,
  "size_bytes"        bigint,
  "failure_reason"    text,
  "expires_at"        timestamptz(6),
  "created_at"        timestamptz(6) NOT NULL DEFAULT now(),
  "completed_at"      timestamptz(6),

  CONSTRAINT "data_exports_pkey"         PRIMARY KEY ("id"),
  CONSTRAINT "data_exports_company_fkey"
    FOREIGN KEY ("company_id")           REFERENCES "companies"("id") ON DELETE Cascade,
  CONSTRAINT "data_exports_requested_by_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")     ON DELETE SET NULL,
  CONSTRAINT "data_exports_status_check"
    CHECK ("status" IN ('pending', 'ready', 'failed', 'expired'))
);

-- "Show me my recent exports, newest first."
CREATE INDEX "idx_data_exports_company_created"
  ON "data_exports" ("company_id", "created_at" DESC);

-- Sweep target: rows past expires_at that still have an r2_key.
-- Partial so the index is tiny — the sweep query also filters status.
CREATE INDEX "idx_data_exports_expired_unswept"
  ON "data_exports" ("expires_at")
  WHERE r2_key IS NOT NULL AND status = 'ready';

ALTER TABLE "data_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_exports" FORCE ROW LEVEL SECURITY;

CREATE POLICY "data_exports_tenant_isolation" ON "data_exports"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "data_exports" TO app_user;
