// Notification types the email system knows about. The 7 "live" entries
// correspond to events that already fire in Sprint 14; the 6 stubs match
// the Sprint 15.3 spec but their triggers don't exist yet (cron for
// deadlines/overdue, hooks on invite-approval, a leave module, etc.). The
// stub templates exist so the registry is exhaustive and future sprints
// only have to wire the trigger — no schema churn for messages.
export type EmailableType =
  // Live (events that fire today):
  | 'task_assigned'
  | 'task_submitted'
  | 'task_approved'
  | 'task_revision_requested'
  | 'task_cancelled'
  | 'task_reassignment_requested'
  | 'comment_mentioned'
  // Stubs (events to be wired in later sprints):
  | 'comment_created'
  | 'deadline_approaching'
  | 'overdue'
  | 'onboarding_approval'
  | 'new_employee'
  | 'leave_reminder';

export type Locale = 'en' | 'ar' | 'ckb';

// Vars passed into a template render. Loose Record so each template can
// document its own expected keys; the renderer just interpolates.
export type TemplateVars = Record<string, string>;

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};
