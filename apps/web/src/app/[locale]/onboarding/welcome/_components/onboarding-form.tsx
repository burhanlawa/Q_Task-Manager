'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/i18n/routing';
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

type Me = {
  id: string;
  firstName: string | null;
  dateOfBirth: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  onboardingCompletedAt: string | null;
};

type Values = {
  dateOfBirth: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    type ErrBody = { message?: string | string[] };
    const eb = parsed as ErrBody | null;
    const msg = Array.isArray(eb?.message) ? eb.message.join(', ') : (eb?.message ?? res.statusText);
    throw new ApiError(msg, res.status, parsed);
  }
  return parsed as T;
}

const TOTAL_STEPS = 3;

export function OnboardingForm() {
  const t = useTranslations('onboarding.welcome');
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Values>({
    dateOfBirth: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  });

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  // If onboarding is already complete, bounce out. Don't show the form to
  // someone who already finished it (e.g. they hit /onboarding/welcome
  // manually).
  useEffect(() => {
    if (me?.onboardingCompletedAt) router.replace('/me/profile');
  }, [me?.onboardingCompletedAt, router]);

  // Pre-fill with anything already on file (mostly relevant if the user
  // partially completed an earlier session and came back).
  useEffect(() => {
    if (me) {
      setValues({
        dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
        address: me.address ?? '',
        emergencyContactName: me.emergencyContactName ?? '',
        emergencyContactPhone: me.emergencyContactPhone ?? '',
        emergencyContactRelationship: me.emergencyContactRelationship ?? '',
      });
    }
  }, [me]);

  const submit = useMutation({
    mutationFn: async () => {
      // PATCH any fields the user filled in. Empty strings → null so we don't
      // overwrite real data with "" by accident.
      const payload: Record<string, string | null> = {};
      for (const k of Object.keys(values) as (keyof Values)[]) {
        const v = values[k];
        payload[k] = v.trim() === '' ? null : v.trim();
      }
      await api.patch('me', payload);
      await apiPost('me/complete-onboarding', {});
    },
    onSuccess: () => {
      toast.success(t('toast.completed'));
      qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/me/profile');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const skip = useMutation({
    mutationFn: async () => {
      // Persist anything the user actually filled in before marking onboarding
      // complete. Empty strings stay omitted so we don't overwrite existing
      // data with null on an early skip.
      const payload: Record<string, string> = {};
      for (const k of Object.keys(values) as (keyof Values)[]) {
        const v = values[k].trim();
        if (v) payload[k] = v;
      }
      if (Object.keys(payload).length > 0) await api.patch('me', payload);
      await apiPost('me/complete-onboarding', {});
    },
    onSuccess: () => {
      toast.success(t('toast.skipped'));
      qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/me/profile');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const prev = () => setStep((s) => Math.max(s - 1, 1));
  const busy = submit.isPending || skip.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('stepLabel', { step, total: TOTAL_STEPS })}</span>
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`h-1.5 w-8 rounded-full ${
                s < step ? 'bg-primary' : s === step ? 'bg-primary/80' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold">{t('step1.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('step1.description')}</p>
          </header>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('fields.dateOfBirth')}</label>
            <Input
              type="date"
              value={values.dateOfBirth}
              onChange={(e) => setValues((v) => ({ ...v, dateOfBirth: e.target.value }))}
            />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold">{t('step2.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('step2.description')}</p>
          </header>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('fields.emergencyContactName')}</label>
            <Input
              value={values.emergencyContactName}
              onChange={(e) =>
                setValues((v) => ({ ...v, emergencyContactName: e.target.value }))
              }
              maxLength={120}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('fields.emergencyContactPhone')}</label>
              <Input
                value={values.emergencyContactPhone}
                onChange={(e) =>
                  setValues((v) => ({ ...v, emergencyContactPhone: e.target.value }))
                }
                placeholder="+964 …"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('fields.emergencyContactRelationship')}
              </label>
              <Input
                value={values.emergencyContactRelationship}
                onChange={(e) =>
                  setValues((v) => ({ ...v, emergencyContactRelationship: e.target.value }))
                }
                placeholder={t('fields.relationshipPlaceholder')}
                maxLength={60}
              />
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold">{t('step3.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('step3.description')}</p>
          </header>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('fields.address')}</label>
            <Input
              value={values.address}
              onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
              placeholder={t('fields.addressPlaceholder')}
              maxLength={500}
            />
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => skip.mutate()}
          disabled={busy}
        >
          {t('actions.skip')}
        </Button>

        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" size="sm" onClick={prev} disabled={busy}>
              <ChevronLeft className="me-1 h-4 w-4" />
              {t('actions.back')}
            </Button>
          )}
          {step < TOTAL_STEPS ? (
            <Button size="sm" onClick={next} disabled={busy}>
              {t('actions.next')}
              <ChevronRight className="ms-1 h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => submit.mutate()} disabled={busy}>
              {submit.isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="me-1 h-4 w-4" />
              )}
              {t('actions.finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
