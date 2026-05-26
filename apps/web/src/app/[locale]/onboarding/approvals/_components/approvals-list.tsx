'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

type ApprovalUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  orgRole: string;
};

type Approval = {
  id: string;
  invitedUserId: string;
  invitedByUserId: string;
  chain: string[];
  currentStepIndex: number;
  status: string;
  createdAt: string;
  invitedBy: ApprovalUser | null;
  invitedUser: ApprovalUser | null;
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

function fullName(u: ApprovalUser | null): string {
  if (!u) return '—';
  return u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ?? u.email;
}

export function ApprovalsList() {
  const t = useTranslations('onboarding.approvals');
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useQuery<Approval[]>({
    queryKey: ['invitations'],
    queryFn: () => api.get('invitations'),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiPost<{ status: string; nextApproverRole: string | null }>(`invitations/${id}/approve`, {}),
    onSuccess: (res) => {
      toast.success(
        res.status === 'approved' ? t('toast.approvedFinal') : t('toast.approvedAdvanced', { next: res.nextApproverRole ?? '?' }),
      );
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const reject = useMutation({
    mutationFn: (args: { id: string; reason: string }) =>
      apiPost(`invitations/${args.id}/reject`, args.reason ? { reason: args.reason } : {}),
    onSuccess: () => {
      toast.success(t('toast.rejected'));
      setRejecting(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (isError) return <p className="text-destructive">{t('loadError')}</p>;
  if (!data || data.length === 0)
    return (
      <div className="rounded-md border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );

  return (
    <>
      <ul className="space-y-3">
        {data.map((a) => {
          const nextRole = a.chain[a.currentStepIndex];
          const busy = approve.isPending || reject.isPending;
          return (
            <li key={a.id} className="rounded-md border p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{fullName(a.invitedUser)}</span>
                    <Badge variant="outline">{a.invitedUser?.orgRole}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.invitedUser?.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('invitedBy')}: {fullName(a.invitedBy)} ({a.invitedBy?.orgRole})
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRejecting(a);
                      setReason('');
                    }}
                    disabled={busy}
                  >
                    <X className="me-1 h-4 w-4" />
                    {t('actions.reject')}
                  </Button>
                  <Button size="sm" onClick={() => approve.mutate(a.id)} disabled={busy}>
                    {approve.isPending ? (
                      <Loader2 className="me-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="me-1 h-4 w-4" />
                    )}
                    {t('actions.approve')}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{t('chainLabel')}:</span>
                {a.chain.map((role, i) => (
                  <Badge
                    key={`${role}-${i}`}
                    variant={i < a.currentStepIndex ? 'secondary' : i === a.currentStepIndex ? 'default' : 'outline'}
                  >
                    {i < a.currentStepIndex && '✓ '}
                    {role}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('nextApprover', { role: nextRole })}
              </p>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!rejecting}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('rejectDialog.description', { name: fullName(rejecting?.invitedUser ?? null) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('rejectDialog.reasonLabel')}</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('rejectDialog.reasonPlaceholder')}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(null);
                setReason('');
              }}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })}
              disabled={reject.isPending}
            >
              {reject.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t('actions.confirmReject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
