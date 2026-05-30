'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

// Sprint 20.4 — Bank-transfer upgrade flow (customer side).
//
// Two states inside this card:
//   1. No pending invoice yet → button "Generate invoice" → POST
//      /billing/checkout/bank-transfer. Server returns the invoice id.
//   2. Pending invoice exists → render the bank details + a reference
//      submission form. The /billing page also reads this so the user
//      sees the same pending state if they navigate away.
//
// Bank details come from GET /billing/bank-details which is env-driven
// server-side. If the deploy hasn't configured them we render a
// neutral "not configured" panel (mirrors the Paddle/Stripe pattern).

type BankDetails = {
  configured: boolean;
  accountName: string | null;
  bankName: string | null;
  iban: string | null;
  swift: string | null;
  instructions: string | null;
};

type PendingInvoice = {
  id: string;
  amountCents: number;
  currency: string;
  paymentReference: string | null;
  issuedAt: string;
} | null;

function formatAmount(cents: number, currency: string): string {
  const major = cents / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(major);
}

export function BankTransferCheckout() {
  const t = useTranslations('billing.upgrade');
  const qc = useQueryClient();
  const [reference, setReference] = useState('');

  const { data: bank } = useQuery<BankDetails>({
    queryKey: ['billing', 'bank-details'],
    queryFn: () => api.get<BankDetails>('/billing/bank-details'),
    staleTime: 60 * 60_000,
  });

  const { data: pending, isLoading: pendingLoading } = useQuery<PendingInvoice>({
    queryKey: ['billing', 'pending-invoice'],
    queryFn: () => api.get<PendingInvoice>('/billing/pending-invoice'),
  });

  const createInvoice = useMutation<{ id: string }, ApiError>({
    mutationFn: () => api.post('/billing/checkout/bank-transfer', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'pending-invoice'] });
      toast.success(t('bank.invoiceCreated'));
    },
    onError: (err) => toast.error(err.message || t('errors.checkoutFailed')),
  });

  const submitReference = useMutation<{ ok: true }, ApiError, { id: string; ref: string }>({
    mutationFn: ({ id, ref }) =>
      api.patch<{ ok: true }>(`/billing/invoices/${id}/reference`, { reference: ref }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'pending-invoice'] });
      toast.success(t('bank.referenceSubmitted'));
    },
    onError: (err) => toast.error(err.message || t('errors.checkoutFailed')),
  });

  if (!bank) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (!bank.configured) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-sm">
        <p className="font-medium">{t('bank.notConfiguredTitle')}</p>
        <p className="mt-2 text-muted-foreground">{t('bank.notConfiguredBody')}</p>
      </div>
    );
  }

  // No pending invoice → show the "Generate invoice" CTA.
  if (!pendingLoading && !pending) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('bank.intro')}</p>
        <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending}>
          {createInvoice.isPending ? t('loading') : t('bank.generateInvoice')}
        </Button>
      </div>
    );
  }

  if (!pending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md bg-muted/30 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('bank.invoice')}
        </p>
        <p className="mt-1 text-2xl font-semibold">
          {formatAmount(pending.amountCents, pending.currency)}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('bank.invoiceId', { id: pending.id.slice(0, 8) })}
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <p className="font-medium">{t('bank.details')}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-muted-foreground">
          <dt>{t('bank.accountName')}</dt>
          <dd className="font-mono text-foreground">{bank.accountName}</dd>
          <dt>{t('bank.bankName')}</dt>
          <dd className="font-mono text-foreground">{bank.bankName}</dd>
          <dt>{t('bank.iban')}</dt>
          <dd className="font-mono text-foreground">{bank.iban}</dd>
          <dt>{t('bank.swift')}</dt>
          <dd className="font-mono text-foreground">{bank.swift}</dd>
        </dl>
        {bank.instructions ? (
          <p className="rounded border bg-background p-3 text-xs text-muted-foreground">
            {bank.instructions}
          </p>
        ) : null}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const ref = reference.trim();
          if (!ref) return;
          submitReference.mutate({ id: pending.id, ref });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="bank-ref">
          {t('bank.referenceLabel')}
        </label>
        <input
          id="bank-ref"
          type="text"
          maxLength={200}
          defaultValue={pending.paymentReference ?? ''}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t('bank.referencePlaceholder')}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">{t('bank.referenceHint')}</p>
        <Button type="submit" disabled={submitReference.isPending || !reference.trim()}>
          {submitReference.isPending ? t('loading') : t('bank.submitReference')}
        </Button>
        {pending.paymentReference ? (
          <p className="text-xs text-muted-foreground">
            {t('bank.pendingReview', { ref: pending.paymentReference })}
          </p>
        ) : null}
      </form>
    </div>
  );
}
