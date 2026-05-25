import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

export async function SiteHeader() {
  const t = await getTranslations('app');

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <span className="text-sm font-semibold">{t('title')}</span>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
