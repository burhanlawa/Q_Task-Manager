import { getTranslations } from 'next-intl/server';
import { NotificationPreferencesForm } from './_form';

export default async function NotificationSettingsPage() {
  const t = await getTranslations('notificationSettings');
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <NotificationPreferencesForm />
    </main>
  );
}
