-- Sprint 8.7: remember the task's status at request time so a rejected
-- reassignment request can restore it. (On approve we drop assignees and
-- reset the task to 'draft', so previous_status is only consulted on reject.)
ALTER TABLE task_reassignment_requests
  ADD COLUMN previous_status task_status;
