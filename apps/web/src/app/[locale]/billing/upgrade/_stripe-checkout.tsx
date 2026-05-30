'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

// Sprint 20.2 — Stripe Checkout (fallback provider).
//
// Server-driven flow: POST to /billing/checkout/stripe → API returns a
// Stripe hosted-checkout URL → window.location.assign. On success Stripe
// redirects to /billing?success=1; on cancel, /billing/upgrade?canceled=1.
//
// Unlike Paddle's inline checkout, Stripe Checkout is a full-page hosted
// experience. This is intentional: it keeps the PCI surface entirely on
// Stripe's side, and the redirect contract is one network hop. The only
// piece we own is the "Open checkout" button + the metadata that lets
// the webhook resolve back to our tenant (companyId, stamped server-side).
//
// "Not configured" state mirrors the Paddle component: if the API
// responds 503 (Stripe envs missing), we show the same panel pattern
// instead of crashing.

type Cycle = 'monthly' | 'annual';

type CheckoutResponse = { url: string; sessionId: string };

export function StripeCheckout() {
  const t = useTranslations('billing.upgrade');
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [notConfigured, setNotConfigured] = useState(false);

  const mutation = useMutation<CheckoutResponse, ApiError>({
    mutationFn: async () => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return api.post<CheckoutResponse>('/billing/checkout/stripe', {
        cycle,
        returnOrigin: origin,
      });
    },
    onSuccess: (data) => {
      window.location.assign(data.url);
    },
    onError: (err) => {
      // 503 from the API = STRIPE_* env vars not set on this deploy.
      // Same UX as the Paddle "not configured" panel — we don't surface
      // an alarm-style toast, we swap to a calm explanation.
      if (err.status === 503) {
        setNotConfigured(true);
        return;
      }
      toast.error(err.message || t('errors.checkoutFailed'));
    },
  });

  if (notConfigured) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-sm">
        <p className="font-medium">{t('notConfigured.title')}</p>
        <p className="mt-2 text-muted-foreground">{t('stripe.notConfiguredBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('stripe.intro')}</p>

      <div className="inline-flex rounded-md border p-1">
        <button
          type="button"
          onClick={() => setCycle('monthly')}
          className={`rounded px-4 py-1.5 text-sm font-medium ${
            cycle === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          {t('cycle.monthly')}
        </button>
        <button
          type="button"
          onClick={() => setCycle('annual')}
          className={`rounded px-4 py-1.5 text-sm font-medium ${
            cycle === 'annual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          {t('cycle.annual')}
          <span className="ms-1 text-xs opacity-75">{t('cycle.annualDiscount')}</span>
        </button>
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full sm:w-auto"
      >
        {mutation.isPending ? t('loading') : t('stripe.openCheckout')}
      </Button>
    </div>
  );
}
