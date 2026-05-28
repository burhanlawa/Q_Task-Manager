import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CompanyLogo } from '@/components/company-logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { HeaderAuth } from '@/components/header-auth';

export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <CompanyLogo />
          <span>{t('app.title')}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          <NotificationBell />
          <HeaderAuth />
        </div>
      </div>
    </header>
  );
}
