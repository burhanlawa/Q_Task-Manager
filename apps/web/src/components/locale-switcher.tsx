'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const labels: Record<Locale, string> = {
  en: 'EN',
  ar: 'العربية',
  ckb: 'کوردی',
};

export function LocaleSwitcher() {
  const active = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === active) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-2" aria-label="Language">
      {routing.locales.map((loc) => {
        const isActive = loc === active;
        return (
          <Button
            key={loc}
            size="sm"
            variant={isActive ? 'default' : 'outline'}
            disabled={isPending}
            aria-pressed={isActive}
            onClick={() => switchTo(loc)}
            className={cn('min-w-16', isActive && 'pointer-events-none')}
          >
            {labels[loc]}
          </Button>
        );
      })}
    </div>
  );
}
