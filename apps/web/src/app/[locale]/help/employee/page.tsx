import { HelpPage, type SectionShape } from '../_components/help-page';

// Sprint 21.7 — Employee guide.
// Day-to-day usage for someone who isn't running the workspace —
// tasks, comments, profile, notifications, leave.

const SECTIONS: SectionShape[] = [
  { key: 'dashboard' },
  { key: 'myTasks' },
  { key: 'taskLifecycle' },
  { key: 'attachments' },
  { key: 'comments' },
  { key: 'mentions' },
  { key: 'reassignment' },
  { key: 'notifications' },
  { key: 'profile' },
  { key: 'leave' },
];

export default function HelpEmployeePage() {
  return <HelpPage namespace="help.employee" sections={SECTIONS} />;
}
