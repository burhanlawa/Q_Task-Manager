import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClerkProvider } from '@clerk/nextjs';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import { NotificationsSubscription } from '@/components/notifications-subscription';
import { OnboardingGate } from '@/components/onboarding-gate';
import { PostHogProvider } from '@/components/posthog-provider';
import { QueryProvider } from '@/components/query-provider';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { routing, getDirection, type Locale } from '@/i18n/routing';
import { getClerkLocalization } from '@/i18n/clerk';
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
  const typedLocale = locale as Locale;

  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      localization={getClerkLocalization(typedLocale)}
    >
      <html lang={locale} dir={getDirection(typedLocale)} suppressHydrationWarning>
        <body>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
              <QueryProvider>
                <PostHogProvider />
                <OnboardingGate />
                <NotificationsSubscription />
                <SiteHeader />
                {children}
                <Toaster richColors position="top-center" />
              </QueryProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
