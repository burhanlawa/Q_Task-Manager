import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CompanyLogo } from '@/components/company-logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { SidebarToggle } from '@/components/site-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { HeaderAuth } from '@/components/header-auth';

export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <SidebarToggle />
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
            <CompanyLogo />
            <span>{t('app.title')}</span>
          </Link>
        </div>
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
