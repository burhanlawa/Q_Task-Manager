'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, type ApiError } from '@/lib/api';

type Settings = { allowImageAttachments: boolean };

export function ImageAttachmentsSection() {
  const t = useTranslations('settings.company.imageAttachments');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['company-settings'],
    queryFn: () => api.get('company-settings'),
  });

  const update = useMutation({
    mutationFn: (next: boolean) =>
      api.patch<Settings>('company-settings', { allow_image_attachments: next }),
    onSuccess: (resp) => {
      queryClient.setQueryData(['company-settings'], resp);
      setError(null);
    },
    onError: (err: ApiError) => {
      setError(err.status === 403 ? t('errors.forbidden') : err.message || t('errors.generic'));
    },
  });

  if (isLoading || !settings) return null;

  return (
    <section className="rounded-md border p-5 space-y-3">
      <div>
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.allowImageAttachments}
          onChange={(e) => update.mutate(e.target.checked)}
          disabled={update.isPending}
          className="h-4 w-4 rounded border-input"
        />
        <span>
          {settings.allowImageAttachments ? t('enabled') : t('disabled')}
        </span>
      </label>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </section>
  );
}
