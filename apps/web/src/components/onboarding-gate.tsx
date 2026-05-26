'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from '@/i18n/routing';
import { useEffect } from 'react';
import { api } from '@/lib/api';

type Me = {
  status: string;
  onboardingCompletedAt: string | null;
};

// Routes that should never trigger the onboarding redirect — auth pages,
// the onboarding page itself, sign-out. Match by suffix so locale prefixes
// don't matter (the i18n usePathname returns the path without the locale).
const EXEMPT_PATHS = [
  '/onboarding/welcome',
  '/sign-in',
  '/sign-up',
  '/sign-out',
];

/**
 * First-sign-in gate (Sprint 7 task 7.5). Watches GET /me; if the user is
 * authenticated, status='active', and onboardingCompletedAt is null, redirect
 * to /onboarding/welcome. Skip when already on an exempt path.
 *
 * Lives in the locale layout so it runs on every page transition. Failures
 * to fetch /me are tolerated silently — the user just doesn't get gated.
 */
export function OnboardingGate() {
  const { isSignedIn, isLoaded } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  useEffect(() => {
    if (!me) return;
    if (me.onboardingCompletedAt) return; // already onboarded
    if (me.status !== 'active') return; // still invited / suspended — different flow
    if (EXEMPT_PATHS.some((p) => pathname.startsWith(p))) return;
    router.replace('/onboarding/welcome');
  }, [me, pathname, router]);

  return null;
}
