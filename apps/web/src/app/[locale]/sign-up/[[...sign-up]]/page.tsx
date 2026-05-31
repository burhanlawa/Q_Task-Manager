import { SignUp } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function SignUpPage() {
  const t = await getTranslations('signup.legal');
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 p-8">
      <SignUp />
      {/* Sprint 21.9 — legal notice at signup. Clerk's hosted SignUp
          form owns the entire signup UX (we can't inject a checkbox
          inside it without a much larger custom-form rebuild). Surfacing
          the notice + links directly underneath the form is the lightest
          MVP-acceptable substitute. */}
      <p className="max-w-md text-center text-xs text-muted-foreground">
        {t.rich('notice', {
          terms: (chunks) => (
            <Link href="/legal/terms" className="text-primary hover:underline">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/legal/privacy" className="text-primary hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
