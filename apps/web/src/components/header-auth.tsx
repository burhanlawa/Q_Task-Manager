'use client';

import { useAuth, UserButton } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export function HeaderAuth() {
  const t = useTranslations('auth');
  const { isLoaded, isSignedIn } = useAuth();

  // Reserve space while Clerk loads to avoid layout shift.
  if (!isLoaded) return <div className="h-9 w-20" aria-hidden />;

  if (isSignedIn) return <UserButton />;

  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/sign-in">{t('signIn')}</Link>
    </Button>
  );
}
