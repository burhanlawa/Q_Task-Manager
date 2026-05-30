-- Sprint 19.2: trial lifecycle support — backfill trial_end_at, plus
-- a flag column so the daily scheduler can be idempotent.
--
-- trial_reminder_sent_at lives directly on the subscriptions row so the
-- scheduler can answer "have I already nudged this tenant?" with a
-- single column check. Using a dedicated column instead of a JSONB blob
-- keeps the lookup indexable and avoids JSON-path-style queries in the
-- worker.

ALTER TABLE "subscriptions"
  ADD COLUMN "trial_reminder_sent_at" timestamptz(6);


--
-- The 19.1 migration seeded one subscription per existing company as
-- status='trialing' but left trial_end_at null. Now that the lifecycle
-- scheduler is wired up, every trialing row needs an end date or the
-- daily job has nothing to evaluate.
--
-- Anchoring on company creation date keeps the math defensible: a tenant
-- created last week still has 7 days of trial left, a tenant created
-- two months ago is already past the cutoff and the scheduler will flip
-- it to 'expired' on its next run. We don't reset everyone to "14 days
-- from now" because that would silently give long-time test tenants a
-- fresh trial they never earned.

UPDATE "subscriptions" s
SET "trial_end_at" = c."created_at" + interval '14 days'
FROM "companies" c
WHERE s."company_id" = c."id"
  AND s."status" = 'trialing'
  AND s."trial_end_at" IS NULL;
