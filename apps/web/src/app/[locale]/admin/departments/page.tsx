import { getTranslations } from 'next-intl/server';
import { DepartmentsTree } from './_components/departments-tree';

export default async function DepartmentsPage() {
  const t = await getTranslations('admin.departments');
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <DepartmentsTree />
    </main>
  );
}
