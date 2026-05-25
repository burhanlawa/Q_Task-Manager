import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-8">
      <SignUp />
    </main>
  );
}
