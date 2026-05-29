'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useTranslations } from 'next-intl';

type AvailableResponse = {
  available: Array<'employee' | 'manager' | 'admin'>;
  primary: 'employee' | 'manager' | 'admin';
};

// Renders nothing visible — fetches the user's available dashboards and
// router.replaces to the primary variant. If the fetch is still in
// flight we show a small "loading" line so the page doesn't look broken.
export function DashboardRedirect() {
  const router = useRouter();
  const t = useTranslations('dashboard.employee');

  const { data } = useQuery<AvailableResponse>({
    queryKey: ['dashboard', 'available'],
    queryFn: () => api.get('dashboard/available'),
    // Cache for the whole session — the server response only changes
    // when org_role / system_roles change, which we don't refresh.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    router.replace(`/dashboard/${data.primary}` as never);
  }, [data, router]);

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-10">
      <p className="text-sm text-muted-foreground">{t('loading')}</p>
    </main>
  );
}
