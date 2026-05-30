import { getTranslations } from 'next-intl/server';
import { UpgradeClient } from './_upgrade-client';

// Server entry-point. The actual data fetching + Paddle.js wiring lives
// in the client component since it needs window + browser-side env vars.
export default async function UpgradePage() {
  const t = await getTranslations('billing.upgrade');
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <UpgradeClient />
    </main>
  );
}
