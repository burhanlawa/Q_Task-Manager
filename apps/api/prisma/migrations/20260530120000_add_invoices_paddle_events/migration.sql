-- Sprint 19.6 — invoices + paddle webhook idempotency log.
--
-- The webhook handler in 19.6 needs two new tables:
--
-- 1. invoices — every transaction.completed gets one row. Sprint 20
--    will add PDF generation + storage on top; for now we capture the
--    Paddle transaction id, the amount + currency Paddle reported, the
--    period it covers, and a status. NO PDF column yet — that gets
--    added when PDF generation lands and we know where the file lives.
--
-- 2. paddle_webhook_events — idempotency log keyed on Paddle's event_id.
--    Paddle retries delivery on non-2xx, and the same notification
--    destination can fire twice during transient network failures. We
--    INSERT the event id BEFORE processing; the unique constraint
--    causes a second delivery to fast-path to 200 without touching the
--    subscriptions row twice. This table is owner-scoped (no RLS) since
--    the webhook handler has no tenant context.

CREATE TABLE "invoices" (
  "id"                     uuid             NOT NULL DEFAULT gen_random_uuid(),
  "company_id"             uuid             NOT NULL,
  "subscription_id"        uuid             NOT NULL,
  -- Paddle's transaction id (txn_*). Unique because a single transaction
  -- maps to a single invoice row; Paddle retries the same txn_ id on
  -- delivery failures and we want the unique-violation to no-op.
  "paddle_transaction_id"  text             NOT NULL,
  "amount_cents"           integer          NOT NULL,
  "currency"               text             NOT NULL,
  "status"                 "invoice_status" NOT NULL DEFAULT 'paid',
  -- Billing period this invoice covers (when Paddle ships those fields).
  -- Null on transactions that aren't subscription renewals (e.g. ad-hoc
  -- charges, though we don't issue those today).
  "billed_at"              timestamptz(6),
  "period_start"           timestamptz(6),
  "period_end"             timestamptz(6),
  "created_at"             timestamptz(6)   NOT NULL DEFAULT now(),
  "updated_at"             timestamptz(6)   NOT NULL DEFAULT now(),

  CONSTRAINT "invoices_pkey"                   PRIMARY KEY ("id"),
  CONSTRAINT "invoices_company_id_fkey"
    FOREIGN KEY ("company_id")      REFERENCES "companies"("id")     ON DELETE Cascade,
  CONSTRAINT "invoices_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE Cascade,
  CONSTRAINT "invoices_amount_nonneg" CHECK ("amount_cents" >= 0)
);

CREATE UNIQUE INDEX "idx_invoices_paddle_transaction_id"
  ON "invoices" ("paddle_transaction_id");

CREATE INDEX "idx_invoices_company_created"
  ON "invoices" ("company_id", "created_at" DESC);

-- Standard tenant RLS.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO app_user;

-- Idempotency log. No RLS because the webhook handler runs with the
-- owner role (no tenant context — Paddle resolves the company via
-- customData on the subscription payload).
CREATE TABLE "paddle_webhook_events" (
  "event_id"     text           NOT NULL,
  "event_type"   text           NOT NULL,
  "received_at"  timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "paddle_webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- Retention: keep ~90 days of dedup history. A future cleanup job will
-- drop rows older than that; for now the table grows unbounded but at
-- typical webhook volume (single-digit events per tenant per month)
-- this is fine for years.
