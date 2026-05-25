'use client';

import { useEffect } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useRouter } from '@/i18n/navigation';

export default function SignOutPage() {
  const { signOut } = useClerk();
  const router = useRouter();

  useEffect(() => {
    void signOut().then(() => router.replace('/'));
  }, [signOut, router]);

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">Signing out…</p>
    </main>
  );
}
