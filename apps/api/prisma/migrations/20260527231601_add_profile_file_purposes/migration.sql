-- Sprint 12.4: profile file purposes.
--
-- 'avatar' already exists and serves as the profile photo. The three new
-- values cover the sensitive profile uploads: CV, ID card photo, and
-- certificates (training/diplomas).
--
-- Postgres requires new enum values to be committed before they can be
-- used in a CHECK / DEFAULT. We're not using any of these as defaults,
-- just inserting rows with them, so a single migration is fine here
-- (unlike Sprint 11.1 where 'not_scanned' became a DEFAULT).
ALTER TYPE "file_purpose" ADD VALUE IF NOT EXISTS 'cv';
ALTER TYPE "file_purpose" ADD VALUE IF NOT EXISTS 'id_card';
ALTER TYPE "file_purpose" ADD VALUE IF NOT EXISTS 'certificate';
