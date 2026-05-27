import { getTranslations } from 'next-intl/server';
import { TasksTable } from './_components/tasks-table';

export default async function TasksPage() {
  const t = await getTranslations('tasks');
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <TasksTable />
    </main>
  );
}
