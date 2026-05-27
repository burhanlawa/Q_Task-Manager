-- Sprint 10.7: remember the date the user typed when auto-adjustment moves
-- due_date forward to land on a working day. NULL means no adjustment was
-- needed (the typed date was already a working day for every assignee).
ALTER TABLE "tasks"
  ADD COLUMN "original_due_date" date;
