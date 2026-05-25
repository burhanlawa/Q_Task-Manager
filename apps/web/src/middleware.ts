import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

// Public routes — no auth required. Locale prefix is optional.
const isPublic = createRouteMatcher([
  '/',
  '/:locale',
  '/:locale/sign-in(.*)',
  '/:locale/sign-up(.*)',
  '/:locale/sign-out',
  '/:locale/debug-sentry',
  '/api/webhooks/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Webhook endpoints skip i18n routing entirely.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (!isPublic(req)) {
    await auth.protect();
  }

  return intlMiddleware(req);
});

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
