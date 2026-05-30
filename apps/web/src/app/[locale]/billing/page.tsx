import { getTranslations } from 'next-intl/server';
import { BillingClient } from './_billing-client';

export default async function BillingPage() {
  const t = await getTranslations('billing.current');
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <BillingClient />
    </main>
  );
}
