-- Sprint 10.5: a tag category can be flagged "mandatory" — task create must
-- include at least one tag from each such category.
--
-- The spec wording was "tags.is_mandatory_category" but the mandate is a
-- property of the *category*, not of every tag within it. Putting it on
-- tag_categories avoids a fan-out duplication that would have to be kept
-- in sync per row. The enforcement query joins task_tags → tags → categories,
-- so the lookup is straightforward either way.
ALTER TABLE "tag_categories"
  ADD COLUMN "is_mandatory" boolean NOT NULL DEFAULT false;

-- Partial index so the validation query (find unsatisfied mandatory
-- categories for a tenant) is a small scan, not a full-table sweep.
CREATE INDEX "idx_tag_categories_company_mandatory"
  ON "tag_categories" ("company_id")
  WHERE is_mandatory = true AND deleted_at IS NULL;
