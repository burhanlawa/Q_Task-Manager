import { HelpPage, type SectionShape } from '../_components/help-page';

// Sprint 21.7 — Admin guide.
// Covers what a CEO/Admin/HR/Manager needs to know to run a tenant.

const SECTIONS: SectionShape[] = [
  { key: 'overview' },
  { key: 'orgStructure' },
  { key: 'invitingUsers' },
  { key: 'rolesPermissions' },
  { key: 'departmentsTeams' },
  { key: 'broadcasts' },
  { key: 'activityLog' },
  { key: 'billing' },
  { key: 'dataExport' },
  { key: 'security' },
];

export default function HelpAdminPage() {
  return <HelpPage namespace="help.admin" sections={SECTIONS} />;
}
