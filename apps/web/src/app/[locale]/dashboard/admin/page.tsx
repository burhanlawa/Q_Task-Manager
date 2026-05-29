import { getTranslations } from 'next-intl/server';
import { AdminDashboard } from './_admin';

export default async function AdminDashboardPage() {
  const t = await getTranslations('dashboard.admin');
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <AdminDashboard />
    </main>
  );
}
