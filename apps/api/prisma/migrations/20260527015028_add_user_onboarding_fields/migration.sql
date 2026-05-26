-- Sprint 7 task 7.5: self-onboarding fields on users.
-- All nullable; populated by the new /onboarding/welcome flow when the
-- invitee first signs in. onboarding_completed_at gates the redirect — once
-- set (either by submission or "skip for now"), the user goes to /me/profile
-- on subsequent sign-ins instead.

ALTER TABLE "users"
  ADD COLUMN "address"                          TEXT,
  ADD COLUMN "emergency_contact_name"           TEXT,
  ADD COLUMN "emergency_contact_phone"          TEXT,
  ADD COLUMN "emergency_contact_relationship"   TEXT,
  ADD COLUMN "onboarding_completed_at"          TIMESTAMPTZ(6);

-- Existing users already in the system shouldn't be redirected to onboarding.
-- Mark all currently-active users as already onboarded.
UPDATE "users"
SET "onboarding_completed_at" = NOW()
WHERE "status" = 'active' AND "deleted_at" IS NULL;
