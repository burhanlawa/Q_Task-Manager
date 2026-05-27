-- Sprint 10.2: task_tags join + tags.usage_count maintained by trigger.
--
-- usage_count is denormalized on tags so "show popular tags" / "sort tag
-- picker by use" can be O(1) reads instead of GROUP BY scans across
-- task_tags. The same trigger pattern is proven in Sprint 8.2 for
-- tasks.assignee_count.

ALTER TABLE "tags"
  ADD COLUMN "usage_count" integer NOT NULL DEFAULT 0;

CREATE TABLE "task_tags" (
  "task_id"    uuid NOT NULL,
  "tag_id"     uuid NOT NULL,
  "added_at"   timestamptz(6) NOT NULL DEFAULT now(),
  "added_by_user_id" uuid,
  CONSTRAINT "task_tags_pkey" PRIMARY KEY ("task_id", "tag_id"),
  CONSTRAINT "task_tags_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "task_tags_tag_id_fkey"
    FOREIGN KEY ("tag_id")  REFERENCES "tags"("id")  ON DELETE CASCADE
);

CREATE INDEX "idx_task_tags_tag"  ON "task_tags" ("tag_id");
CREATE INDEX "idx_task_tags_task" ON "task_tags" ("task_id");

-- RLS via the parent task: a row is visible iff its task is visible to the
-- current tenant. We don't need a company_id column here because task_id
-- already carries that scoping through tasks.
ALTER TABLE "task_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_tags" FORCE ROW LEVEL SECURITY;

CREATE POLICY "task_tags_tenant_isolation" ON "task_tags"
  USING (
    EXISTS (
      SELECT 1 FROM "tasks" t
      WHERE t.id = task_tags.task_id
        AND t.company_id = current_setting('app.current_company_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "tasks" t
      WHERE t.id = task_tags.task_id
        AND t.company_id = current_setting('app.current_company_id', true)::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_tags" TO app_user;

-- usage_count trigger. INSERT bumps the new tag; DELETE bumps the old.
-- Handles bulk operations via FOR EACH ROW; statement-level isn't needed
-- because we never UPDATE a row's tag_id in this design.
CREATE OR REPLACE FUNCTION update_tag_usage_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = OLD.tag_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_tags_usage_count
  AFTER INSERT OR DELETE ON task_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();
