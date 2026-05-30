-- Sprint 20.3 — Stripe subscription/customer ids + webhook idempotency.
--
-- The Sprint 19.1 subscriptions table only had paddle_subscription_id /
-- paddle_customer_id because Paddle was the sole provider at the time.
-- Sprint 20 adds Stripe as the fallback path; tenants whose country
-- Paddle doesn't onboard subscribe through Stripe, and we need to
-- remember their Stripe ids the same way.
--
-- Both new columns are nullable + partial-unique so a Paddle row has
-- only paddle_* set, a Stripe row has only stripe_* set, and a trialing
-- row has neither. The local subscriptions row stays one-per-company
-- via the existing companyId unique index — provider is just metadata.
--
-- The webhook idempotency log mirrors paddle_webhook_events: keyed on
-- Stripe's event id, owner-only (no RLS — the handler has no tenant
-- context). Kept as a separate table so a Stripe event id colliding
-- with a Paddle event id (vanishingly unlikely but theoretically
-- possible since both providers issue arbitrary strings) doesn't cause
-- cross-provider replay confusion.

ALTER TABLE "subscriptions"
  ADD COLUMN "stripe_subscription_id" text,
  ADD COLUMN "stripe_customer_id"     text;

CREATE UNIQUE INDEX "idx_subscriptions_stripe_subscription_id"
  ON "subscriptions" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;

CREATE TABLE "stripe_webhook_events" (
  "event_id"     text           NOT NULL,
  "event_type"   text           NOT NULL,
  "received_at"  timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("event_id")
);
