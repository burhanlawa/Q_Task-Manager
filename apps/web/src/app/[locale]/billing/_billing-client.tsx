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
  seats: { used: number; limit: number; unlimited: boolean };
  // Bytes serialized as strings so values past Number.MAX_SAFE_INTEGER
  // (enterprise sentinel) survive the wire intact.
  storage: { usedBytes: string; limitBytes: string; unlimited: boolean };
};

// Bytes → human-readable. We choose units relative to the value, not a
// fixed GB scale, so a free tenant with 12 KB used doesn't read as
// "0.00 GB used."
function formatBytes(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

// 0-1 ratio for the progress bar. Caps at 1 so a slightly-over-limit
// state (rare, but possible if usage was retroactively re-counted)
// still renders as a full bar, not an overflowing one.
function ratio(usedStr: string, limitStr: string, unlimited: boolean): number {
  if (unlimited) return 0;
  const used = Number(usedStr);
  const limit = Number(limitStr);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(used / limit, 1);
}

function UsageBar({ value }: { value: number }) {
  // Color shifts to amber past 75%, red past 90% so the upgrade nudge
  // is visual, not just textual.
  const pct = Math.round(value * 100);
  const color =
    value >= 0.9 ? 'bg-destructive' : value >= 0.75 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`${color} h-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

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

  const seatRatio = data.seats.unlimited ? 0 : Math.min(data.seats.used / data.seats.limit, 1);
  const storageRatio = ratio(data.storage.usedBytes, data.storage.limitBytes, data.storage.unlimited);

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

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('usage.title')}
        </h2>
        <div className="mt-4 space-y-5">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{t('usage.seats')}</p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {data.seats.unlimited
                  ? t('usage.seatsValueUnlimited', { used: data.seats.used })
                  : t('usage.seatsValue', { used: data.seats.used, limit: data.seats.limit })}
              </p>
            </div>
            <div className="mt-2">
              <UsageBar value={seatRatio} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{t('usage.storage')}</p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {data.storage.unlimited
                  ? t('usage.storageValueUnlimited', { used: formatBytes(data.storage.usedBytes) })
                  : t('usage.storageValue', {
                      used: formatBytes(data.storage.usedBytes),
                      limit: formatBytes(data.storage.limitBytes),
                    })}
              </p>
            </div>
            <div className="mt-2">
              <UsageBar value={storageRatio} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
