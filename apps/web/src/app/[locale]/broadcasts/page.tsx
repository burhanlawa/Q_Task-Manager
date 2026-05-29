import { getTranslations } from 'next-intl/server';
import { BroadcastsList } from './_list';

export default async function BroadcastsPage() {
  const t = await getTranslations('broadcasts.list');
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <BroadcastsList />
    </main>
  );
}
