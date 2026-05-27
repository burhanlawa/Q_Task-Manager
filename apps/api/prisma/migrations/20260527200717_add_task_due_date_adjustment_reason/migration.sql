-- Sprint 10.8: store why due_date was auto-adjusted so the UI can render
-- a specific reason ("extended for assignee leave") rather than the generic
-- "non-working day." Values are the same tokens 10.7 writes to
-- activity_log.metadata.reason: 'weekend', 'holiday', 'assignee_on_leave',
-- or a '+'-joined combination (e.g. 'weekend+assignee_on_leave').
ALTER TABLE "tasks"
  ADD COLUMN "due_date_adjustment_reason" text;
