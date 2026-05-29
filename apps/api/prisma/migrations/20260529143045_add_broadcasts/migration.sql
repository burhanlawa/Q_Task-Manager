-- Sprint 16.1: broadcasts (no recipients table in MVP).
--
-- Per blueprint v2.0, broadcasts are fire-and-forget company-wide
-- announcements. We DO NOT track per-recipient acknowledgement in MVP —
-- broadcast_recipients was explicitly dropped from the schema. The
-- ack_required + ack_count columns stay so Phase 2 can wire receipt
-- tracking without a migration on a populated table.
--
-- Fan-out lives entirely in the application: a broadcast insert triggers
-- audience resolution → one notification row per recipient → existing
-- email + Pusher plumbing carries the rest. The broadcast row itself is
-- the source of truth ("which broadcasts has this tenant sent?"); the
-- recipient-facing copy is the per-user notification row.
--
-- Audience filter shape (JSONB, validated at the application layer):
--   all_company → {}                                  (no filter needed)
--   branch      → { "branch_id": "<uuid>" }
--   role        → { "role_id":   "<uuid>" }
--   custom      → { "user_ids":  ["<uuid>", ...] }

CREATE TABLE "broadcasts" (
  "id"               uuid                NOT NULL DEFAULT gen_random_uuid(),
  "company_id"       uuid                NOT NULL,
  -- The user who sent it. SET NULL on user delete so the broadcast row
  -- survives a sender departure (history matters for audit).
  "sender_user_id"   uuid,
  "title"            text                NOT NULL,
  "body"             text                NOT NULL,
  "audience"         "broadcast_audience" NOT NULL,
  -- Per-kind filter (branch_id / role_id / user_ids). Schema-validated
  -- in the application; the DB just stores whatever JSON it gets.
  "audience_filter"  jsonb               NOT NULL DEFAULT '{}'::jsonb,
  -- Phase-2 fields. Kept now so we don't migrate a populated table later.
  -- ack_required = "the sender wants explicit read confirmation."
  -- ack_count    = denormalized counter the Phase-2 endpoint will bump.
  "ack_required"     boolean             NOT NULL DEFAULT false,
  "ack_count"        integer             NOT NULL DEFAULT 0,
  "created_at"       timestamptz(6)      NOT NULL DEFAULT now(),
  -- Soft-delete only; we never recall the emails the workers already sent,
  -- but the broadcast disappears from listings + the bell after delete.
  "deleted_at"       timestamptz(6),

  CONSTRAINT "broadcasts_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "broadcasts_company_id_fkey"
    FOREIGN KEY ("company_id")     REFERENCES "companies"("id") ON DELETE Cascade,
  CONSTRAINT "broadcasts_sender_user_id_fkey"
    FOREIGN KEY ("sender_user_id") REFERENCES "users"("id")     ON DELETE SET NULL,
  -- ack_count is a counter; nonsense values shouldn't be possible even
  -- through a buggy Phase-2 update.
  CONSTRAINT "broadcasts_ack_count_nonneg"   CHECK ("ack_count" >= 0)
);

-- Tenant timeline: "show me this company's broadcasts, newest first."
-- Filtered to non-deleted rows since that's the common case; deleted-included
-- queries can fall back to a full scan on the much smaller historical set.
CREATE INDEX "idx_broadcasts_company_created"
  ON "broadcasts" ("company_id", "created_at" DESC)
  WHERE deleted_at IS NULL;

-- "Broadcasts I sent" view for admin/CEO dashboards.
CREATE INDEX "idx_broadcasts_sender_created"
  ON "broadcasts" ("sender_user_id", "created_at" DESC)
  WHERE deleted_at IS NULL AND sender_user_id IS NOT NULL;

-- Standard tenant RLS. No per-user scope — broadcasts are company-wide
-- objects and every member of the tenant can see the rows they're a recipient
-- of (the recipient gate lives on the notifications row, not here).
ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "broadcasts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "broadcasts_tenant_isolation" ON "broadcasts"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "broadcasts" TO app_user;
