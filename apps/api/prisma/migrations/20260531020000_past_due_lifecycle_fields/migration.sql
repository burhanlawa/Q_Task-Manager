-- Sprint 20.6 — past-due lifecycle state machine columns.
--
-- Blueprint §3.2 dunning ladder:
--   Day 1-7   → warning emails (status=past_due, read_only_at null)
--   Day 7-14  → read-only flag set on company
--   Day 14-30 → status=paused (suspension)
--   Day 30-120→ status=expired (locked)
--   Day 120   → tenant deletion job queued
--
-- The day-count is measured from subscriptions.past_due_at, which is
-- stamped by the webhook handlers (Paddle 19.6 + Stripe 20.3) at the
-- moment status flips to past_due. We add:
--
--   subscriptions.past_due_at — anchor for the ladder math. Stamped
--     once on entry; cleared on recovery. Never re-stamped on
--     subsequent payment_failed events (so the ladder doesn't reset).
--
--   subscriptions.past_due_warning_sent_at — idempotency for the day
--     1-7 warning email batch. Daily cron checks NULL before sending.
--
--   subscriptions.deletion_enqueued_at — idempotency for the day-120
--     deletion job enqueue. Without this, every daily cron after
--     day 120 would re-enqueue. Stamped once when enqueued.
--
--   companies.read_only_at — set at day 7. Drives the read-only gate
--     that the rest of the app uses to refuse writes (Sprint 20.7
--     will plumb this into the guards; for now it's just a timestamp
--     that the lifecycle processor maintains).

ALTER TABLE "subscriptions"
  ADD COLUMN "past_due_at"               timestamptz(6),
  ADD COLUMN "past_due_warning_sent_at"  timestamptz(6),
  ADD COLUMN "deletion_enqueued_at"      timestamptz(6);

ALTER TABLE "companies"
  ADD COLUMN "read_only_at" timestamptz(6);

-- Backfill: any subscription already at status='past_due' from prior
-- test runs gets past_due_at set to now() so the ladder has a starting
-- point. Without this, a stale past_due row would never advance.
UPDATE "subscriptions"
SET "past_due_at" = now()
WHERE "status" = 'past_due' AND "past_due_at" IS NULL;
