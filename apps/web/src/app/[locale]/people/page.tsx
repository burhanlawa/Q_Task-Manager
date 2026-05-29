import { getTranslations } from 'next-intl/server';
import { InvitePersonDialog } from './_components/invite-person-dialog';
import { PeopleTable } from './_components/people-table';

export default async function PeoplePage() {
  const t = await getTranslations('people');
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <InvitePersonDialog />
      </header>
      <PeopleTable />
    </main>
  );
}
