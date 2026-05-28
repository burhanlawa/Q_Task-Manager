-- Sprint 13.4: comment attachments live under their own purpose so we can
-- query "all files attached to comment X" without filtering through
-- task_attachment rows.
ALTER TYPE "file_purpose" ADD VALUE IF NOT EXISTS 'comment_attachment';
