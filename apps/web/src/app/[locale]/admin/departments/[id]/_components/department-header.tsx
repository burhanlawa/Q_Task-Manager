'use client';

import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { api, type Department } from '@/lib/api';

export function DepartmentHeader({ departmentId }: { departmentId: string }) {
  const t = useTranslations('admin.departments');
  const { data, isLoading, isError } = useQuery<Department>({
    queryKey: ['department', departmentId],
    queryFn: () => api.get(`departments/${departmentId}`),
  });

  return (
    <header className="space-y-3">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/departments">
          <ChevronLeft className="me-1 h-4 w-4" />
          {t('backToTree')}
        </Link>
      </Button>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isLoading ? t('loading') : isError ? t('loadError') : data?.name}
        </h1>
        <p className="text-sm text-muted-foreground">{t('detailDescription')}</p>
      </div>
    </header>
  );
}
