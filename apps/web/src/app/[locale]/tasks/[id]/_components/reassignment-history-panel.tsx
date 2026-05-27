'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

type Person = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type RequestRow = {
  id: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  previousStatus: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  requester: Person | null;
  decider: Person | null;
};

function nameOf(p: Person | null): string {
  if (!p) return '—';
  return p.displayName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() ?? p.email;
}

const STATUS_VARIANT: Record<RequestRow['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

export function ReassignmentHistoryPanel({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.reassignment.history');

  const { data, isLoading } = useQuery<{ items: RequestRow[] }>({
    queryKey: ['task', taskId, 'reassignmentHistory'],
    queryFn: () => api.get(`tasks/${taskId}/reassignment-requests`),
  });

  if (isLoading) return null;
  if (!data || data.items.length === 0) return null;

  return (
    <details className="rounded-md border p-5">
      <summary className="cursor-pointer text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground">
        {t('title', { count: data.items.length })}
      </summary>
      <ol className="mt-4 space-y-4">
        {data.items.map((r) => (
          <li key={r.id} className="rounded-md border bg-background p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-medium">{nameOf(r.requester)}</span>{' '}
                <span className="text-muted-foreground">
                  {t('requestedOn', { when: new Date(r.createdAt).toLocaleString() })}
                </span>
              </span>
              <Badge variant={STATUS_VARIANT[r.status]}>
                {t(`status.${r.status}` as 'status.pending')}
              </Badge>
            </div>

            {r.reason && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('reason')}</p>
                <p className="text-sm whitespace-pre-wrap">{r.reason}</p>
              </div>
            )}

            {r.status !== 'pending' && r.decidedAt && (
              <div className="border-t pt-2">
                <p className="text-sm">
                  <span className="font-medium">{nameOf(r.decider)}</span>{' '}
                  <span className="text-muted-foreground">
                    {t(`decidedOn.${r.status}` as 'decidedOn.approved', {
                      when: new Date(r.decidedAt).toLocaleString(),
                    })}
                  </span>
                </p>
                {r.decisionNote && (
                  <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                    {r.decisionNote}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
