import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import { PostHogProvider } from '@/components/posthog-provider';
import { routing, getDirection, type Locale } from '@/i18n/routing';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Q Task Manager',
  description: 'Task management for businesses in Iraq, Kurdistan, and MENA.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} dir={getDirection(locale as Locale)}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PostHogProvider />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
