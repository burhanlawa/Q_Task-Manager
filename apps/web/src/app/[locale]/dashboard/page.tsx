import { getTranslations } from 'next-intl/server';
import { EmployeeDashboard } from './_employee';

// Sprint 18.5 — Employee dashboard at /dashboard.
//
// For now this is the only role-variant; Manager/Admin dashboards will
// live at sibling routes when 18.x ships them. The sidebar routes
// every signed-in user here regardless of org_role; the API call
// returns the same employee bundle to all roles (every user has
// their OWN tasks/notifications to surface). Future tasks may switch
// this page to dispatch on org_role.

export default async function DashboardPage() {
  const t = await getTranslations('dashboard.employee');
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <EmployeeDashboard />
    </main>
  );
}
