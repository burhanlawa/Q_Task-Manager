-- Sprint 21.5 — hot-path indexes identified by code audit.
--
-- Two genuinely-missing indexes after a check against pg_indexes:
--
-- 1. tasks_company_status_updated — the admin dashboard's
--    "completed-last-30" query filters by (company_id, status='completed',
--    updated_at >= since). The existing idx_tasks_company_status covers
--    (company_id, status) but the date predicate falls back to a scan
--    over the matching rows. With (company_id, status, updated_at DESC)
--    + WHERE deleted_at IS NULL the planner can range-scan directly.
-- 2. users_company_created — /people list orders by createdAt ASC,
--    scoped to companyId. The existing idx_users_company_id covers the
--    filter; sorting then needs a separate operation. A composite
--    (company_id, created_at ASC) lets the index supply both.
--
-- The other two indexes I would have added (idx_tasks_company_status
-- and idx_notifications_user_unread) already exist in the DB — Prisma's
-- schema-level @@index decorators got out of sync with pg_indexes
-- somewhere in history. Functionality is intact; we just don't
-- duplicate them here.

CREATE INDEX "idx_tasks_company_status_updated"
  ON "tasks" ("company_id", "status", "updated_at" DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX "idx_users_company_created"
  ON "users" ("company_id", "created_at" ASC);
