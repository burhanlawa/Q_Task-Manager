'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

// What the GET /broadcasts/audience-options endpoint returns. The server
// is the source of truth for what THIS user can pick; we render only those.
type AudienceOptions = {
  role: string;
  allowed: AudienceKind[];
  myDepartmentId: string | null;
  myBranchId: string | null;
  myTeamIds: string[];
};
type AudienceKind = 'company' | 'all_company' | 'branch' | 'department' | 'team' | 'role' | 'custom';

// What we POST. The server normalizes 'all_company' → 'company' on the way out.
type CreateBroadcastBody = {
  title: string;
  body: string;
  audience: AudienceKind;
  audience_filter?: { target_ids?: string[] };
};

type CreateBroadcastResponse = {
  id: string;
  audience: AudienceKind;
  recipientCount: number;
  notifiedCount: number;
};

export function BroadcastComposer() {
  const t = useTranslations('broadcasts.new');
  const router = useRouter();

  const { data: opts, isLoading, error } = useQuery<AudienceOptions>({
    queryKey: ['broadcasts', 'audience-options'],
    queryFn: () => api.get('broadcasts/audience-options'),
    retry: false,
  });

  // The picker shows ONLY what opts.allowed lists. For scoped roles we
  // also auto-fill target_ids (Manager → their dept; Supervisor → their
  // team(s)) so the form isn't a maze.
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AudienceKind | ''>('');

  // When the options load, default to the first allowed kind so the
  // picker isn't empty on render.
  useEffect(() => {
    if (opts && !audience && opts.allowed.length > 0) {
      // Prefer the most specific scope: team > department > company.
      const preferred = (['team', 'department', 'company', 'all_company'] as AudienceKind[]).find(
        (k) => opts.allowed.includes(k),
      );
      setAudience(preferred ?? opts.allowed[0]);
    }
  }, [opts, audience]);

  // Auto-derive target_ids from the user's scope for non-picker roles.
  // For CEO/Admin/HR + custom selection we'll keep a TODO for v2; for
  // the 16.4 done check we only need scoped roles to be locked down.
  const target_ids = useMemo<string[]>(() => {
    if (!opts || !audience) return [];
    if (audience === 'company' || audience === 'all_company') return [];
    if (audience === 'department' && opts.myDepartmentId) return [opts.myDepartmentId];
    if (audience === 'team') return opts.myTeamIds;
    if (audience === 'branch' && opts.myBranchId) return [opts.myBranchId];
    return [];
  }, [opts, audience]);

  const send = useMutation({
    mutationFn: (payload: CreateBroadcastBody) =>
      api.post<CreateBroadcastResponse>('broadcasts', payload),
    onSuccess: (data) => {
      toast.success(t('sentToast', { count: data.recipientCount }));
      router.push('/');
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : String((err as Error)?.message ?? '');
      toast.error(t('errorToast', { message: msg }));
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }
  if (error || !opts || opts.allowed.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('permissionDenied')}</p>;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!audience) return;
    send.mutate({
      title: title.trim(),
      body: body.trim(),
      audience,
      audience_filter: target_ids.length ? { target_ids } : undefined,
    });
  }

  // Show a small "scope hint" so the user knows their scoped-role broadcast
  // is targeting THEIR dept / team, not asking them to pick from a list.
  const scopeHint = scopedHint(opts, audience, t);

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border bg-card p-6">
      <div className="space-y-2">
        <Label htmlFor="title">{t('titleField')}</Label>
        <Input
          id="title"
          maxLength={200}
          required
          placeholder={t('titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">{t('bodyField')}</Label>
        <textarea
          id="body"
          rows={6}
          maxLength={5000}
          required
          placeholder={t('bodyPlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={cn(
            'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="audience">{t('audience')}</Label>
        <Select value={audience} onValueChange={(v) => setAudience(v as AudienceKind)}>
          <SelectTrigger id="audience">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opts.allowed
              // De-dup the all_company / company alias in the picker.
              .filter((k) => k !== 'all_company')
              .map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`audiencePicker.${k}`)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {scopeHint && <p className="text-xs text-muted-foreground">{scopeHint}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={send.isPending || !title || !body || !audience}>
          {send.isPending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}

function scopedHint(
  opts: AudienceOptions,
  audience: AudienceKind | '',
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (audience === 'department' && opts.role !== 'ceo' && opts.role !== 'admin' && opts.role !== 'hr') {
    return t('scopedPicker.myDepartment');
  }
  if (audience === 'team' && opts.role !== 'ceo' && opts.role !== 'admin' && opts.role !== 'hr') {
    return opts.myTeamIds.length === 1
      ? t('scopedPicker.myTeam')
      : t('scopedPicker.myTeams', { count: opts.myTeamIds.length });
  }
  return null;
}
