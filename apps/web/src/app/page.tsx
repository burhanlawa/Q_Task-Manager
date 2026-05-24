import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-bold tracking-tight text-primary">Q Task Manager</h1>
      <p className="text-muted-foreground">
        Trilingual task management for Iraq, Kurdistan, and MENA.
      </p>
      <Button>Get started</Button>
    </main>
  );
}
