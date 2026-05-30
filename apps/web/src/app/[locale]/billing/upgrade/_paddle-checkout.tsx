'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

// Sprint 19.5 — Paddle.js inline checkout.
//
// The Paddle SDK is loaded from a <script> tag and attaches itself to
// window.Paddle. We keep its initialization side-effects out of React's
// render path (single useEffect on mount), and we DON'T tear down the
// instance between renders — Paddle.Checkout.open is idempotent enough
// that re-opening on a price change just swaps the cart.
//
// Env contract (all four required for a real checkout):
//   NEXT_PUBLIC_PADDLE_ENV               'sandbox' | 'production'
//   NEXT_PUBLIC_PADDLE_CLIENT_TOKEN      Vendor client-side token
//   NEXT_PUBLIC_PADDLE_PRICE_MONTHLY     Price ID for Pro Monthly
//   NEXT_PUBLIC_PADDLE_PRICE_ANNUAL      Price ID for Pro Annual
//
// If ANY are missing we render a disabled "checkout not configured"
// state with a link to the followups doc. Useful while we don't have
// Paddle account access from Iraq — keeps the page renderable end-to-end
// and the integration code real, so once env vars are populated it
// "just works."

type Cycle = 'monthly' | 'annual';

const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

// Loosely typed handle on the Paddle.js global. The SDK ships its own
// TypeScript types in @paddle/paddle-js, but we're loading the CDN
// build to keep the bundle slim; this is enough surface area for the
// inline-checkout path we use.
type PaddleGlobal = {
  Environment: { set: (env: 'sandbox' | 'production') => void };
  Initialize: (opts: { token: string; eventCallback?: (ev: PaddleEvent) => void }) => void;
  Checkout: {
    open: (opts: {
      items: { priceId: string; quantity: number }[];
      customData?: Record<string, string>;
      settings?: {
        displayMode?: 'inline' | 'overlay';
        theme?: 'light' | 'dark';
        locale?: string;
        frameTarget?: string;
        frameInitialHeight?: number;
        frameStyle?: string;
        successUrl?: string;
        allowLogout?: boolean;
      };
    }) => void;
    close?: () => void;
  };
};

type PaddleEvent = {
  name: string;
  data?: unknown;
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

export function PaddleCheckout({ companyId }: { companyId: string | null }) {
  const t = useTranslations('billing.upgrade');
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const env = process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production' | undefined;
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const priceMonthly = process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY;
  const priceAnnual = process.env.NEXT_PUBLIC_PADDLE_PRICE_ANNUAL;
  const configured = Boolean(env && clientToken && priceMonthly && priceAnnual);

  // Load Paddle.js once. The script self-attaches Paddle to window; we
  // poll readiness via the onload handler. Subsequent renders no-op.
  useEffect(() => {
    if (!configured) return;
    if (typeof window === 'undefined') return;
    if (window.Paddle) {
      setScriptReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PADDLE_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => setScriptReady(true), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = PADDLE_SCRIPT_URL;
    s.async = true;
    s.onload = () => setScriptReady(true);
    s.onerror = () => setError('paddle_script_failed');
    document.head.appendChild(s);
  }, [configured]);

  // Initialize once the script is up. Re-initializing is harmless per
  // Paddle docs but we still guard so we don't trigger their analytics
  // multiple times.
  useEffect(() => {
    if (!scriptReady || !configured) return;
    const Paddle = window.Paddle!;
    Paddle.Environment.set(env!);
    Paddle.Initialize({
      token: clientToken!,
      eventCallback: (ev) => {
        // On a completed transaction Paddle posts 'checkout.completed';
        // we forward to /billing?success=1 so the page shows the toast
        // even before the webhook lands and writes the subscription row.
        if (ev.name === 'checkout.completed') {
          router.replace('/billing?success=1');
        }
      },
    });
  }, [scriptReady, configured, env, clientToken, router]);

  function openCheckout() {
    if (!configured || !window.Paddle) return;
    const priceId = cycle === 'monthly' ? priceMonthly! : priceAnnual!;
    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: companyId ? { companyId } : undefined,
      settings: {
        displayMode: 'inline',
        theme: 'light',
        frameTarget: 'paddle-checkout-frame',
        frameInitialHeight: 450,
        frameStyle: 'width:100%; min-width:312px; background:transparent; border:none;',
        successUrl:
          typeof window !== 'undefined' ? `${window.location.origin}/billing?success=1` : undefined,
      },
    });
  }

  if (!configured) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-sm">
        <p className="font-medium">{t('notConfigured.title')}</p>
        <p className="mt-2 text-muted-foreground">{t('notConfigured.body')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      <Button onClick={openCheckout} disabled={!scriptReady} className="w-full sm:w-auto">
        {scriptReady ? t('openCheckout') : t('loading')}
      </Button>

      {error ? (
        <p className="text-sm text-destructive">{t('errors.scriptFailed')}</p>
      ) : null}

      <div
        ref={containerRef}
        className="paddle-checkout-frame rounded-lg border"
        style={{ minHeight: scriptReady ? 0 : undefined }}
      />
    </div>
  );
}
