-- Sprint 11.8: tenant's billing plan, used to gate storage usage.
--
-- The subscription_plan enum already exists (starter | growth | enterprise).
-- We're storing the active plan on companies for now; when a real
-- subscriptions table lands with billing, this column moves there and the
-- storage-limit check just reads from the new location.
--
-- Default 'starter' (1 GB) is the free tier — tightest limit, safest default
-- for new tenants. Admin can change it later via direct DB until UI lands.
ALTER TABLE "companies"
  ADD COLUMN "plan" subscription_plan NOT NULL DEFAULT 'starter';
