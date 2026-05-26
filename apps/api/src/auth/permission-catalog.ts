/**
 * Canonical, grouped permission catalog (Sprint 6 task 6.5).
 *
 * Single source of truth for the permission keys recognised across the app.
 * The Roles admin UI fetches this via GET /api/v1/permissions to render
 * grouped checkboxes; PermissionsGuard accepts any string in `permissions:`
 * but only keys in this catalog are surfaced for editing in the UI.
 *
 * The wildcard `*` is intentionally NOT in this catalog — the UI renders it
 * as a separate "Full access" toggle so it doesn't get buried in a category.
 *
 * Strings here are placeholders pending blueprint §4.13. When §4.13 lands,
 * this file is the only place to update; builtin-roles.ts should reference
 * these constants by import rather than embedding strings.
 */
export type PermissionGroup = {
  category: string;
  description: string;
  permissions: { key: string; label: string }[];
};

export const PERMISSION_CATALOG: readonly PermissionGroup[] = [
  {
    category: 'Branches',
    description: 'Manage company branches.',
    permissions: [
      { key: 'branch.read', label: 'View branches' },
      { key: 'branch.create', label: 'Create branches' },
      { key: 'branch.update', label: 'Update branches' },
      { key: 'branch.archive', label: 'Archive / restore branches' },
    ],
  },
  {
    category: 'Departments',
    description: 'Manage departments within a branch.',
    permissions: [
      { key: 'department.read', label: 'View departments' },
      { key: 'department.create', label: 'Create departments' },
      { key: 'department.update', label: 'Update departments' },
      { key: 'department.archive', label: 'Archive / restore departments' },
    ],
  },
  {
    category: 'Teams',
    description: 'Manage teams within a department.',
    permissions: [
      { key: 'team.read', label: 'View teams' },
      { key: 'team.create', label: 'Create teams' },
      { key: 'team.update', label: 'Update teams' },
      { key: 'team.archive', label: 'Archive / restore teams' },
    ],
  },
  {
    category: 'Users',
    description: 'Invite, edit, and manage company users.',
    permissions: [
      { key: 'user.read', label: 'View users (own department)' },
      { key: 'user.read.companywide', label: 'View users (company-wide)' },
      { key: 'user.read.sensitive', label: 'View sensitive fields (DOB, national ID)' },
      { key: 'user.create', label: 'Invite users' },
      { key: 'user.update', label: 'Update users' },
      { key: 'user.archive', label: 'Archive / restore users' },
      { key: 'user.assign_system_role', label: 'Grant / revoke system roles' },
    ],
  },
  {
    category: 'Roles & permissions',
    description: 'Manage who can do what across the tenant.',
    permissions: [{ key: 'role.manage', label: 'List + edit role permissions' }],
  },
  {
    category: 'Tasks',
    description: 'Create and act on tasks (full surface lands in Sprint 8).',
    permissions: [
      { key: 'task.read', label: 'View tasks' },
      { key: 'task.create', label: 'Create tasks' },
      { key: 'task.update', label: 'Update tasks' },
      { key: 'task.update.own', label: 'Update own tasks' },
      { key: 'task.assign', label: 'Assign tasks' },
      { key: 'task.assign_cross_department', label: 'Assign tasks across departments' },
      { key: 'task.archive', label: 'Archive tasks' },
    ],
  },
  {
    category: 'Comments',
    description: 'Comment on tasks (Sprint 13).',
    permissions: [
      { key: 'comment.read', label: 'View comments' },
      { key: 'comment.create', label: 'Create comments' },
    ],
  },
  {
    category: 'Reports',
    description: 'Access cross-tenant reports.',
    permissions: [{ key: 'report.read', label: 'View reports' }],
  },
];

export const ALL_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key)),
);
