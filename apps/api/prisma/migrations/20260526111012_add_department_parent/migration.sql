-- Sprint 4 task 4.2: add nesting to departments.
--
-- - Add parent_department_id (nullable, self-ref FK to departments.id).
-- - onDelete Restrict: cannot delete a parent that still has children, matches
--   the convention used on every other tenant-scoped FK in this schema.
-- - Sibling-uniqueness on name: drop the per-branch unique and replace with
--   (branch_id, parent_department_id, name). Children of "IT" can be named
--   "Mobile Dev" even if "Engineering" also has a "Mobile Dev" child.
--   NULL is treated as distinct in postgres unique indexes, so two root depts
--   with the same name in the same branch would still be allowed — handled
--   via a partial unique on the root case.

ALTER TABLE "departments"
  ADD COLUMN "parent_department_id" UUID NULL;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_parent_department_id_fkey"
  FOREIGN KEY ("parent_department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_departments_parent_id" ON "departments" ("parent_department_id");

-- Drop the old per-branch unique and replace with sibling-uniqueness.
DROP INDEX IF EXISTS "idx_departments_branch_name";

CREATE UNIQUE INDEX "idx_departments_branch_parent_name"
  ON "departments" ("branch_id", "parent_department_id", "name");

-- NULLs are distinct in btree unique indexes (Postgres default), so the index
-- above does NOT enforce uniqueness across root departments. Add a partial
-- index for the root case to cover "two root depts with the same name in one
-- branch" → blocked.
CREATE UNIQUE INDEX "idx_departments_branch_root_name"
  ON "departments" ("branch_id", "name")
  WHERE "parent_department_id" IS NULL;
