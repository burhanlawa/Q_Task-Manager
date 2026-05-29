import { getTranslations } from 'next-intl/server';
import { ActivityLogViewer } from './_viewer';

export default async function ActivityLogPage() {
  const t = await getTranslations('activity');
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <ActivityLogViewer />
    </main>
  );
}
