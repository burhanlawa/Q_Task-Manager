'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

type Requester = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type RequestRow = {
  id: string;
  reason: string | null;
  previousStatus: string | null;
  status: string;
  createdAt: string;
  requestedByUserId: string;
};

type PendingResponse = {
  request: RequestRow | null;
  requester: Requester | null;
};

function requesterName(r: Requester): string {
  return r.displayName ?? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() ?? r.email;
}

export function ReassignmentDecisionPanel({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.reassignment.decide');
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PendingResponse>({
    queryKey: ['task', taskId, 'pendingReassignment'],
    queryFn: () => api.get(`tasks/${taskId}/reassignment-requests/pending`),
  });

  const decide = useMutation({
    mutationFn: (body: { decision: 'approved' | 'rejected'; note?: string }) =>
      api.post<{ task: unknown }>(`tasks/${taskId}/reassignment-decision`, body),
    onSuccess: (resp) => {
      const updated = (resp as { task: unknown }).task;
      if (updated) queryClient.setQueryData(['task', taskId], updated);
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'pendingReassignment'] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'reassignmentHistory'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setNote('');
      setError(null);
    },
    onError: (err: ApiError) => setError(err.message || t('errors.generic')),
  });

  if (isLoading) return null;
  if (!data?.request || !data.requester) return null;

  const { request, requester } = data;

  return (
    <section className="rounded-md border border-amber-500/50 bg-amber-500/10 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('subtitle', {
            who: requesterName(requester),
            when: new Date(request.createdAt).toLocaleString(),
          })}
        </p>
      </header>

      <div className="rounded-md border bg-background p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('reasonLabel')}</p>
        <p className="mt-1 text-sm whitespace-pre-wrap">{request.reason ?? '—'}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="note" className="text-sm font-medium">
          {t('noteLabel')}
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={t('notePlaceholder')}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <Button
          variant="outline"
          disabled={decide.isPending}
          onClick={() => {
            const ok = window.confirm(t('confirm.rejected'));
            if (!ok) return;
            decide.mutate({ decision: 'rejected', note: note.trim() || undefined });
          }}
        >
          {t('reject')}
        </Button>
        <Button
          disabled={decide.isPending}
          onClick={() => {
            const ok = window.confirm(t('confirm.approved'));
            if (!ok) return;
            decide.mutate({ decision: 'approved', note: note.trim() || undefined });
          }}
        >
          {t('approve')}
        </Button>
      </div>
    </section>
  );
}
