-- Sprint 3 task 3.9: close the gap left by 2.7. RLS was enabled on every
-- tenant-scoped *child* table (branches, departments, teams, users, roles)
-- but the companies table itself was never protected. A user in company A
-- could read any other company's row by UUID — caught by the isolation suite.
--
-- Policy: a session can only see its own company row. The same predicate as
-- the child tables, except the column is `id`, not `company_id`.

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "companies_tenant_isolation" ON "companies"
  USING      (id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_company_id', true)::uuid);
