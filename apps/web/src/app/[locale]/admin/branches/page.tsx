import { getTranslations } from 'next-intl/server';
import { BranchesTable } from './_components/branches-table';
import { CreateBranchDialog } from './_components/create-branch-dialog';

export default async function BranchesPage() {
  const t = await getTranslations('admin.branches');
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <CreateBranchDialog />
      </header>
      <BranchesTable />
    </main>
  );
}
