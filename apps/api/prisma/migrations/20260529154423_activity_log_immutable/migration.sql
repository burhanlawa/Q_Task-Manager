-- Sprint 17.3: make activity_log immutable from the application role.
--
-- Audit history must be append-only. The Sprint 5 migration granted
-- SELECT/INSERT/UPDATE/DELETE to app_user because the standard grant block
-- did so for every new table; that was always wrong for activity_log.
--
-- This migration revokes UPDATE + DELETE so even a buggy controller or a
-- compromised app role cannot rewrite history. The owner role
-- (neondb_owner, used for migrations) keeps full privileges so we can
-- still drop old partitions or correct schema mistakes via a follow-up
-- migration.
--
-- The 17.1 partitioned parent and each child partition need the revoke
-- applied independently — Postgres grants on the parent DO propagate to
-- new partitions automatically, but existing ones still carry whatever
-- they were granted at create time. We REVOKE on the parent (covers
-- future partitions) and loop over current children.

REVOKE UPDATE, DELETE ON "activity_log" FROM app_user;

DO $$
DECLARE
  partition_name text;
BEGIN
  FOR partition_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE p.relname = 'activity_log'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_user', partition_name);
  END LOOP;
END $$;
