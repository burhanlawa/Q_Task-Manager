-- Sprint 2 task 2.7: enable Row-Level Security on every tenant-scoped table.
--
-- Pattern: every policy uses current_setting('app.current_company_id', true)::uuid
-- The `true` second arg means missing_ok — if the setting isn't set, current_setting
-- returns NULL and the comparison fails, so SELECT returns 0 rows (the done check).
--
-- FORCE is required: Neon's neondb_owner is the table owner and would otherwise
-- bypass RLS entirely, defeating the isolation guarantee.

-- ===== branches =====
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "branches_tenant_isolation" ON "branches"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- ===== departments =====
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "departments_tenant_isolation" ON "departments"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- ===== teams =====
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
CREATE POLICY "teams_tenant_isolation" ON "teams"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- ===== users =====
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_tenant_isolation" ON "users"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- ===== roles =====
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "roles_tenant_isolation" ON "roles"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

-- ===== Application role (no BYPASSRLS) =====
-- Neon grants BYPASSRLS to the project owner (neondb_owner) and does not allow
-- stripping it. We create a separate app_user role for runtime queries — it has
-- DML privileges on public.* but no BYPASSRLS, so RLS policies actually apply.
-- The owner role stays as-is for migrations.
--
-- The app must connect to Postgres as app_user (set APP_DATABASE_URL in env).
-- Password is a placeholder here; rotate via Neon console and store in env.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'replace_me_in_env'
      NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user;
