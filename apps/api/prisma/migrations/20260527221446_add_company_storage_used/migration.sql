-- Sprint 11.7: track storage used per tenant.
--
-- The spec called for subscriptions.storage_used, but the subscriptions
-- table doesn't exist yet (billing lands later). Storing this on
-- companies.storage_used_bytes for now — it'll move to subscriptions when
-- billing arrives, but the value stays a sum of files.size_bytes for the
-- company regardless of where the column lives.
--
-- Maintained by a trigger on the files table, same pattern as
-- tasks.assignee_count (Sprint 8.2) and tags.usage_count (Sprint 10.2).
-- We only count files that are uploaded AND not soft-deleted — a pending
-- upload that never lands isn't actually consuming storage, and a
-- soft-deleted row's bytes have been (or will be) reclaimed.

ALTER TABLE "companies"
  ADD COLUMN "storage_used_bytes" bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT "companies_storage_used_bytes_nonneg"
    CHECK (storage_used_bytes >= 0);

-- Initial backfill — any 'uploaded' rows that exist before this trigger
-- lands should be counted. Empty in fresh installs but matters for
-- environments that already have files.
UPDATE "companies" c SET storage_used_bytes = COALESCE(s.total, 0)
FROM (
  SELECT company_id, SUM(size_bytes)::bigint AS total
  FROM files
  WHERE upload_status = 'uploaded' AND deleted_at IS NULL
  GROUP BY company_id
) s WHERE s.company_id = c.id;

-- Trigger function. Three transitions matter:
--   * INSERT with upload_status='uploaded'             → add size_bytes
--   * UPDATE pending_upload → uploaded                 → add size_bytes
--   * UPDATE uploaded       → anything-else (incl. soft-delete) → subtract
--   * DELETE of an uploaded row                        → subtract
-- GREATEST(., 0) guards against any arithmetic that would push us
-- negative (shouldn't happen, but cheap insurance).
CREATE OR REPLACE FUNCTION update_company_storage_used() RETURNS trigger AS $$
DECLARE
  was_counted boolean;
  is_counted  boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.upload_status = 'uploaded' AND NEW.deleted_at IS NULL THEN
      UPDATE companies
        SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
        WHERE id = NEW.company_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    was_counted := OLD.upload_status = 'uploaded' AND OLD.deleted_at IS NULL;
    is_counted  := NEW.upload_status = 'uploaded' AND NEW.deleted_at IS NULL;
    IF was_counted AND NOT is_counted THEN
      UPDATE companies
        SET storage_used_bytes = GREATEST(storage_used_bytes - OLD.size_bytes, 0)
        WHERE id = OLD.company_id;
    ELSIF NOT was_counted AND is_counted THEN
      UPDATE companies
        SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
        WHERE id = NEW.company_id;
    ELSIF was_counted AND is_counted AND OLD.size_bytes <> NEW.size_bytes THEN
      -- size mutated while still counted (unlikely path, but cheap to handle)
      UPDATE companies
        SET storage_used_bytes = GREATEST(
          storage_used_bytes - OLD.size_bytes + NEW.size_bytes, 0
        )
        WHERE id = NEW.company_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.upload_status = 'uploaded' AND OLD.deleted_at IS NULL THEN
      UPDATE companies
        SET storage_used_bytes = GREATEST(storage_used_bytes - OLD.size_bytes, 0)
        WHERE id = OLD.company_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_files_storage_used
  AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION update_company_storage_used();
