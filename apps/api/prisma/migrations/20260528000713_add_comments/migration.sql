-- Sprint 13.1: comments and comment_mentions.
--
-- Comments are bound to a task and authored by a user. The 'body' column
-- holds rich-text HTML (TipTap output). edited_at is set whenever an edit
-- lands within the 15-minute window — created_at always reflects the
-- original creation time so the window math stays trivial.
--
-- parent_comment_id is reserved for future nested-thread support. v1 only
-- inserts NULL there; the column is here so we don't need a migration to
-- enable nesting later.
--
-- comment_mentions is a denormalized index for "who was @-mentioned where."
-- The rich-text body carries the mentions visually; the table powers fast
-- "show me all my mentions" queries and feeds the notification fan-out
-- when that lands (Sprint 14+).

CREATE TABLE "comments" (
  "id"                 uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"         uuid           NOT NULL,
  "task_id"            uuid           NOT NULL,
  "author_user_id"     uuid           NOT NULL,
  "parent_comment_id"  uuid,
  "body"               text           NOT NULL,
  "created_at"         timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at"         timestamptz(6) NOT NULL DEFAULT now(),
  "edited_at"          timestamptz(6),
  "deleted_at"         timestamptz(6),
  CONSTRAINT "comments_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "comments_company_id_fkey"
    FOREIGN KEY ("company_id")        REFERENCES "companies"("id") ON DELETE Restrict,
  CONSTRAINT "comments_task_id_fkey"
    FOREIGN KEY ("task_id")           REFERENCES "tasks"("id")     ON DELETE Cascade,
  CONSTRAINT "comments_author_user_id_fkey"
    FOREIGN KEY ("author_user_id")    REFERENCES "users"("id")     ON DELETE Restrict,
  CONSTRAINT "comments_parent_comment_id_fkey"
    FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id")  ON DELETE Cascade,
  CONSTRAINT "comments_body_nonempty"
    CHECK (char_length(btrim(body)) > 0)
);

-- Reads on the task detail page are "all comments for this task, oldest
-- first." Partial WHERE deleted_at IS NULL keeps the index small.
CREATE INDEX "idx_comments_task_created"
  ON "comments" ("task_id", "created_at")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_comments_company_created"
  ON "comments" ("company_id", "created_at")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_comments_author"
  ON "comments" ("author_user_id")
  WHERE deleted_at IS NULL;
CREATE INDEX "idx_comments_parent"
  ON "comments" ("parent_comment_id")
  WHERE deleted_at IS NULL AND parent_comment_id IS NOT NULL;

-- RLS — same shape as other tenant-scoped tables.
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "comments_tenant_isolation" ON "comments"
  USING (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "comments" TO app_user;

-- updated_at trigger uses the existing global set_updated_at() function.
CREATE TRIGGER trg_comments_set_updated_at
  BEFORE UPDATE ON "comments"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------- comment_mentions ----------------

CREATE TABLE "comment_mentions" (
  "id"                 uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"         uuid           NOT NULL,
  "comment_id"         uuid           NOT NULL,
  "mentioned_user_id"  uuid           NOT NULL,
  "created_at"         timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comment_mentions_comment_id_fkey"
    FOREIGN KEY ("comment_id")        REFERENCES "comments"("id") ON DELETE Cascade,
  CONSTRAINT "comment_mentions_mentioned_user_id_fkey"
    FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id")    ON DELETE Cascade,
  CONSTRAINT "comment_mentions_company_id_fkey"
    FOREIGN KEY ("company_id")        REFERENCES "companies"("id") ON DELETE Restrict,
  -- A given user is "mentioned" at most once per comment; multiple @-spans
  -- inside the same body collapse to one row.
  CONSTRAINT "comment_mentions_unique"
    UNIQUE ("comment_id", "mentioned_user_id")
);

-- "Show me my mentions, newest first" — keyed by mentioned_user_id.
CREATE INDEX "idx_comment_mentions_user"
  ON "comment_mentions" ("mentioned_user_id", "created_at" DESC);
CREATE INDEX "idx_comment_mentions_comment"
  ON "comment_mentions" ("comment_id");
CREATE INDEX "idx_comment_mentions_company"
  ON "comment_mentions" ("company_id", "created_at" DESC);

-- RLS via the denormalized company_id (cheaper than joining through comments
-- on every read; same pattern as task_reassignment_requests from Sprint 8.3).
ALTER TABLE "comment_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment_mentions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "comment_mentions_tenant_isolation" ON "comment_mentions"
  USING (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "comment_mentions" TO app_user;
