-- Sprint 6 task 6.1: department manager pointer.
-- The founder is set as manager of the auto-created Executive department on
-- signup (webhook 3.4). Nullable so other depts can exist without a manager;
-- ON DELETE SET NULL keeps the dept row alive if the manager is archived.

ALTER TABLE "departments" ADD COLUMN "manager_id" UUID;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "idx_departments_manager_id" ON "departments" ("manager_id");
