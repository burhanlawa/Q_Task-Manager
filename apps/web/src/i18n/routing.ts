import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ar', 'ckb'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export const rtlLocales: readonly Locale[] = ['ar', 'ckb'];

export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return (rtlLocales as readonly string[]).includes(locale) ? 'rtl' : 'ltr';
}
