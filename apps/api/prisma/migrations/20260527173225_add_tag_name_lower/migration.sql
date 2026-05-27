-- Sprint 10.1: case-insensitive tags via a STORED generated column.
--
-- Why GENERATED ALWAYS AS (LOWER(name)) STORED rather than `citext` or a
-- functional index alone:
--   * It's portable Postgres (no extension); citext requires CREATE EXTENSION.
--   * STORED means a real column the app can SELECT/index/order by; lookups
--     are plain b-tree, not function-call dependent.
--   * The unique index below uses the same column the lookup uses — no
--     "must match the expression exactly" foot-guns that come with
--     functional indexes.
--
-- The same column lands on `tag_categories` so category names are also
-- case-insensitive (selecting an "HR" vs "hr" category shouldn't dupe).

ALTER TABLE "tags"
  ADD COLUMN "name_lower" text GENERATED ALWAYS AS (LOWER("name")) STORED;

ALTER TABLE "tag_categories"
  ADD COLUMN "name_lower" text GENERATED ALWAYS AS (LOWER("name")) STORED;

-- Case-insensitive uniqueness inside a category. The previous
-- (category_id, name) unique still stands for the display-name uniqueness,
-- but this is the one we'll actually rely on for "is there already a tag
-- by this name?" lookups regardless of how the user typed it.
CREATE UNIQUE INDEX "idx_tags_category_name_lower"
  ON "tags" ("category_id", "name_lower")
  WHERE deleted_at IS NULL;

-- Same idea on categories within a company.
CREATE UNIQUE INDEX "idx_tag_categories_company_name_lower"
  ON "tag_categories" ("company_id", "name_lower")
  WHERE deleted_at IS NULL;
