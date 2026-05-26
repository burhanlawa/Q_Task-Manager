/**
 * Built-in roles seeded into every new tenant on signup (Sprint 4 task 4.5).
 *
 * Permission strings are placeholders pending blueprint §4.13's canonical list.
 * The `@RequirePermissions(...)` infrastructure treats any unknown key as
 * unsatisfied (deny by default), so getting the strings wrong is safe — the
 * worst case is "user gets 403 on an endpoint they should reach" rather than
 * "user reaches an endpoint they shouldn't."
 *
 * CEO and Admin both get the wildcard `*` so the founder and any future admin
 * can fully operate without us having to enumerate every key today.
 *
 * The founder is granted the CEO role at signup (see clerk-webhook.service.ts).
 * Other roles exist but are unassigned until UI for role assignment lands.
 */
export type BuiltinRole = {
  name: string;
  description: string;
  permissions: string[];
};

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  {
    name: 'CEO',
    description: 'Founder; full access to every action in the tenant.',
    permissions: ['*'],
  },
  {
    name: 'Admin',
    description: 'Company-wide administrator; full access to settings, users, roles.',
    permissions: ['*'],
  },
  {
    name: 'Manager',
    description:
      'Manages branches/departments/teams, invites people, and oversees the tasks within them.',
    permissions: [
      'branch.read',
      'department.create',
      'department.update',
      'department.archive',
      'department.read',
      'team.create',
      'team.update',
      'team.archive',
      'team.read',
      'user.create',
      'user.read',
      'user.update',
      'task.create',
      'task.update',
      'task.assign',
      'task.archive',
      'task.read',
      'report.read',
    ],
  },
  {
    name: 'Supervisor',
    description: 'Leads one or more teams; assigns and tracks tasks within them.',
    permissions: [
      'branch.read',
      'department.read',
      'team.read',
      'user.read',
      'task.create',
      'task.update',
      'task.assign',
      'task.read',
      'comment.create',
      'comment.read',
    ],
  },
  {
    name: 'Employee',
    description: 'Default role for regular staff; can act on their own tasks.',
    permissions: ['task.read', 'task.update.own', 'comment.create', 'comment.read'],
  },
  {
    name: 'HR',
    description: 'Manages company users, employment status, and HR-scoped reports.',
    permissions: [
      'branch.read',
      'department.read',
      'team.read',
      'user.create',
      'user.update',
      'user.archive',
      'user.read',
      'report.read',
    ],
  },
];
