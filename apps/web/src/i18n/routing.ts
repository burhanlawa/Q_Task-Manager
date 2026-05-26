import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['en', 'ar', 'ckb'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

// Locale-aware navigation helpers — Link prefixes the current locale, so
// <Link href="/admin/branches"> automatically goes to /en/admin/branches etc.
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);

export type Locale = (typeof routing.locales)[number];

export const rtlLocales: readonly Locale[] = ['ar', 'ckb'];

export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return (rtlLocales as readonly string[]).includes(locale) ? 'rtl' : 'ltr';
}
