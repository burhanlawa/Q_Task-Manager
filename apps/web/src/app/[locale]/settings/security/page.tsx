import { UserProfile } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';

export default async function SecurityPage() {
  const t = await getTranslations('security');

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <UserProfile routing="hash" />
    </main>
  );
}
