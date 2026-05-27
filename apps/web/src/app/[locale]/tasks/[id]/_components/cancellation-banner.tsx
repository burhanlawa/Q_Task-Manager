'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

type Actor = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type ActivityRow = {
  id: string;
  actionType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: Actor | null;
};

function nameOf(a: Actor | null): string {
  if (!a) return '—';
  return a.displayName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() ?? a.email;
}

export function CancellationBanner({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.cancel.banner');

  const { data } = useQuery<{ items: ActivityRow[] }>({
    queryKey: ['task', taskId, 'activity'],
    queryFn: () => api.get(`tasks/${taskId}/activity`),
  });

  const cancelEvent = data?.items.find((r) => r.actionType === 'task_cancelled');
  if (!cancelEvent) return null;

  const note = (cancelEvent.metadata as { note?: string } | null)?.note;

  return (
    <section className="rounded-md border border-destructive/50 bg-destructive/10 p-5 space-y-2">
      <header>
        <h2 className="text-sm font-semibold text-destructive uppercase tracking-wide">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('subtitle', {
            who: nameOf(cancelEvent.actor),
            when: new Date(cancelEvent.createdAt).toLocaleString(),
          })}
        </p>
      </header>
      {note ? (
        <div className="rounded-md border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">{t('reasonLabel')}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{note}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">{t('noReason')}</p>
      )}
    </section>
  );
}
