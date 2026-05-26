import { Link } from '@/i18n/routing';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { EditBranchForm } from './_components/edit-branch-form';

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('admin.branches');

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 md:p-10">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/branches">
            <ChevronLeft className="me-1 h-4 w-4" />
            {t('backToList')}
          </Link>
        </Button>
      </div>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('editTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('editDescription')}</p>
      </header>
      <EditBranchForm branchId={id} />
    </main>
  );
}
