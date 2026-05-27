-- Sprint 12.1: file version chain.
--
-- A "new version of file X" is a brand-new files row that points at X via
-- previous_version_id. The old row stays as 'uploaded' and downloadable for
-- audit/rollback; soft-delete the chain explicitly if you want to retire it.
-- Each version carries its own version_number (1, 2, 3, ...) so a query that
-- already has a row doesn't need to chase the chain to know where it sits.
--
-- The 11.7 storage_used_bytes trigger counts every uploaded row, so each
-- version contributes its own size to the plan limit. If we later decide
-- "only latest version counts," we patch the trigger to filter on
-- "no children point at me," but that's a separate decision.
ALTER TABLE "files"
  ADD COLUMN "previous_version_id" uuid,
  ADD COLUMN "version_number" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "files_previous_version_id_fkey"
    FOREIGN KEY ("previous_version_id") REFERENCES "files"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "files_version_number_positive"
    CHECK (version_number >= 1);

CREATE INDEX "idx_files_previous_version"
  ON "files" ("previous_version_id")
  WHERE deleted_at IS NULL AND previous_version_id IS NOT NULL;
