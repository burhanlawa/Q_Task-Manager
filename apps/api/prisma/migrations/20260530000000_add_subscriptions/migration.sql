-- Sprint 19.1: subscriptions table (Paddle primary, v2.0).
--
-- Until now, billing state was stored as two denormalized columns on
-- companies (plan + status). That was a stopgap; the real billing model
-- needs more fields than fit on the tenant row (period boundaries, trial
-- end, provider ids, cancel-at-period-end flag) and may eventually be
-- one-to-many if we ever support add-on subscriptions per company.
--
-- This migration:
--   1. Creates the subscriptions table with the v2.0 paddle_* columns
--      and a payment_provider column (defaults to 'paddle').
--   2. Backfills exactly ONE row per existing company. We seed every
--      row with status='trialing' per the task spec ("trial state").
--      The plan column is copied from companies.plan so existing
--      starter/growth/enterprise assignments survive the migration.
--   3. Keeps companies.plan and companies.status in place as a
--      denormalized cache. The Sprint 18.7 admin dashboard reads
--      from them; future Paddle webhook handlers will write to BOTH
--      the subscriptions row (source of truth) AND the companies cache.
--
-- RLS pattern matches every other tenant table: company_id must equal
-- the session's app.current_company_id GUC. The owner role (used by
-- migrations and the Paddle webhook handler, which runs without a
-- tenant context) bypasses RLS as usual.

CREATE TABLE "subscriptions" (
  "id"                       uuid                  NOT NULL DEFAULT gen_random_uuid(),
  "company_id"               uuid                  NOT NULL,
  -- Mirror of the companies cache columns; will diverge during Paddle
  -- webhook processing for the few milliseconds between the row update
  -- and the cache sync.
  "plan"                     "subscription_plan"   NOT NULL DEFAULT 'starter',
  "status"                   "subscription_status" NOT NULL DEFAULT 'trialing',
  "billing_cycle"            "billing_cycle"       NOT NULL DEFAULT 'monthly',
  -- v2.0: Paddle is the primary provider. Stripe is the fallback (Sprint 20).
  "payment_provider"         "payment_provider"    NOT NULL DEFAULT 'paddle',
  -- Paddle identifiers — nullable until the company actually checks out.
  -- During the free trial we have a subscriptions row but no Paddle objects yet.
  "paddle_subscription_id"   text,
  "paddle_customer_id"       text,
  -- Period boundaries reported by Paddle. Null until first paid period starts.
  "current_period_start"     timestamptz(6),
  "current_period_end"       timestamptz(6),
  -- Trial cutoff. Default-trial-on-signup logic sets this; left null when
  -- the company is already paying (trialing → active transition clears it).
  "trial_end_at"             timestamptz(6),
  -- When the user clicks Cancel mid-period we set this true rather than
  -- immediately downgrading; the Paddle webhook then flips status to
  -- 'cancelled' at period end.
  "cancel_at_period_end"     boolean               NOT NULL DEFAULT false,
  "created_at"               timestamptz(6)        NOT NULL DEFAULT now(),
  "updated_at"               timestamptz(6)        NOT NULL DEFAULT now(),

  CONSTRAINT "subscriptions_pkey"                     PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE Cascade
);

-- One active billing row per tenant. Phase 2 add-on subs would relax this.
CREATE UNIQUE INDEX "idx_subscriptions_company_id"
  ON "subscriptions" ("company_id");

-- Webhook lookup path: Paddle delivers events keyed by their subscription id,
-- and we need to resolve back to our row fast. Partial index because the
-- column is null during the pre-checkout trial period.
CREATE UNIQUE INDEX "idx_subscriptions_paddle_subscription_id"
  ON "subscriptions" ("paddle_subscription_id")
  WHERE paddle_subscription_id IS NOT NULL;

-- Standard tenant RLS.
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO app_user;

-- Backfill: one row per existing company. The task spec asks for
-- status='trial' but the enum value is 'trialing' (subscription_status
-- doesn't have a bare 'trial' member). We seed every row as trialing so
-- the assumption "every company has a subscriptions row" holds from this
-- migration forward — that invariant is what the rest of Sprint 19 relies on.
INSERT INTO "subscriptions" ("company_id", "plan", "status", "billing_cycle", "payment_provider")
SELECT
  c.id,
  c.plan,
  'trialing'::subscription_status,
  'monthly'::billing_cycle,
  'paddle'::payment_provider
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "subscriptions" s WHERE s.company_id = c.id
);
