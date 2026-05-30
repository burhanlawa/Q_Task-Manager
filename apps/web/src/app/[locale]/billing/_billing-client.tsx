'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type BillingMe = {
  plan: string;
  status: string;
  billingCycle: string;
  trialEndAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function BillingClient() {
  const t = useTranslations('billing.current');
  const params = useSearchParams();

  // ?success=1 lands here from the Paddle checkout completion callback.
  // We fire the toast in an effect so it survives strict-mode double
  // renders and doesn't fire during SSR (no toast container yet).
  useEffect(() => {
    if (params.get('success') === '1') {
      toast.success(t('successToast'));
    }
  }, [params, t]);

  const { data, isLoading } = useQuery<BillingMe>({
    queryKey: ['billing', 'me'],
    queryFn: () => api.get<BillingMe>('/billing/me'),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (!data) {
    return <p className="text-sm text-destructive">{t('error')}</p>;
  }

  const trialEnd = data.trialEndAt ? new Date(data.trialEndAt).toLocaleDateString() : null;
  const periodEnd = data.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('currentPlan')}
            </p>
            <p className="text-2xl font-semibold capitalize">{data.plan}</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
            {data.status}
          </span>
        </div>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('billingCycle')}</dt>
            <dd className="font-medium capitalize">{data.billingCycle}</dd>
          </div>
          {trialEnd && data.status === 'trialing' ? (
            <div>
              <dt className="text-muted-foreground">{t('trialEnds')}</dt>
              <dd className="font-medium">{trialEnd}</dd>
            </div>
          ) : null}
          {periodEnd ? (
            <div>
              <dt className="text-muted-foreground">{t('renewsOn')}</dt>
              <dd className="font-medium">{periodEnd}</dd>
            </div>
          ) : null}
          {data.cancelAtPeriodEnd ? (
            <div>
              <dt className="text-muted-foreground">{t('cancellation')}</dt>
              <dd className="font-medium">{t('cancelsAtPeriodEnd')}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-6">
          <Button asChild>
            <Link href="/billing/upgrade">{t('upgradeCta')}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
