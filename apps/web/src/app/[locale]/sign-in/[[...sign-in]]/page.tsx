import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
