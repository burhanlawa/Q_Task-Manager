import { createClerkClient, type ClerkClient } from '@clerk/backend';

export const CLERK_CLIENT = Symbol('CLERK_CLIENT');

export const clerkClientProvider = {
  provide: CLERK_CLIENT,
  useFactory: (): ClerkClient => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!secretKey) throw new Error('CLERK_SECRET_KEY is required');
    if (!publishableKey) throw new Error('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
    return createClerkClient({ secretKey, publishableKey });
  },
};
