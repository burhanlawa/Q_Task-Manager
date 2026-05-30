'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { BankTransferCheckout } from './_bank-transfer';
import { PaddleCheckout } from './_paddle-checkout';
import { StripeCheckout } from './_stripe-checkout';

type Me = { id: string; companyId: string };
// /billing/me returns more than this; we only narrow to the field that
// drives the provider switch so the rest of the page (which doesn't
// load /billing/me) stays a single tiny query.
type BillingProvider = { checkoutProvider: 'paddle' | 'stripe' };

// Static Pro feature list — content matches the blueprint §3.2 plan
// table. Lives here rather than i18n keys because the Card structure
// is what the page is selling; the strings just label it.
function ProFeatures({
  t,
}: {
  t: (key: string) => string;
}) {
  const features = [
    t('features.unlimitedUsers'),
    t('features.storage'),
    t('features.allReports'),
    t('features.priority'),
  ];
  return (
    <ul className="space-y-2 text-sm">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

type PayMethod = 'card' | 'bank';

export function UpgradeClient() {
  const t = useTranslations('billing.upgrade');
  const [method, setMethod] = useState<PayMethod>('card');

  // Fetch /me so we can pass companyId into Paddle's customData. The
  // webhook handler (19.6) reads it to resolve which tenant the
  // transaction belongs to before updating the subscription row.
  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/me'),
    staleTime: 5 * 60_000,
  });

  // Provider routing (Sprint 20.2) lives server-side in
  // pickCheckoutProvider — countries Paddle doesn't onboard get the
  // Stripe path, everyone else gets Paddle. /billing/me already
  // computes this so we don't restate the rule on the client.
  const { data: billing } = useQuery<BillingProvider>({
    queryKey: ['billing', 'me'],
    queryFn: () => api.get<BillingProvider>('/billing/me'),
    staleTime: 5 * 60_000,
  });
  const provider = billing?.checkoutProvider ?? 'paddle';

  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            {t('plan.pro')}
          </p>
          <h2 className="text-3xl font-bold">{t('plan.priceMonthly')}</h2>
          <p className="text-sm text-muted-foreground">{t('plan.priceMonthlySuffix')}</p>
        </div>
        <div className="mt-6 border-t pt-6">
          <ProFeatures t={t} />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5 inline-flex rounded-md border p-1">
          <button
            type="button"
            onClick={() => setMethod('card')}
            className={`rounded px-4 py-1.5 text-sm font-medium ${
              method === 'card' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            {t('methods.card')}
          </button>
          <button
            type="button"
            onClick={() => setMethod('bank')}
            className={`rounded px-4 py-1.5 text-sm font-medium ${
              method === 'bank' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            {t('methods.bank')}
          </button>
        </div>

        {method === 'card' ? (
          provider === 'stripe' ? (
            <StripeCheckout />
          ) : (
            <PaddleCheckout companyId={me?.companyId ?? null} />
          )
        ) : (
          <BankTransferCheckout />
        )}
      </section>
    </div>
  );
}
