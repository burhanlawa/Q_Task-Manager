import { getTranslations } from 'next-intl/server';
import { EditTaskForm } from './_components/edit-task-form';

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('tasks.edit');
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <EditTaskForm taskId={id} />
    </main>
  );
}
