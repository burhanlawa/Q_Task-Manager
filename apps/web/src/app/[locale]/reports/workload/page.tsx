import { getTranslations } from 'next-intl/server';
import { WorkloadChart } from './_chart';

export default async function WorkloadPage() {
  const t = await getTranslations('reports.workload');
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <WorkloadChart />
    </main>
  );
}
