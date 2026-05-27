-- Sprint 11.1 prep: extend virus_scan_status with 'not_scanned' (default
-- state for newly-uploaded files). Postgres requires new enum values to
-- be committed before they can be referenced — splitting this off into
-- its own migration lets the next migration use it as a DEFAULT.
ALTER TYPE "virus_scan_status" ADD VALUE IF NOT EXISTS 'not_scanned' BEFORE 'pending';
