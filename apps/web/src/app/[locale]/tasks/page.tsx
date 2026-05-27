import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { TasksTable } from './_components/tasks-table';

export default async function TasksPage() {
  const t = await getTranslations('tasks');
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild>
          <Link href="/tasks/new">{t('newTask')}</Link>
        </Button>
      </header>
      <TasksTable />
    </main>
  );
}
