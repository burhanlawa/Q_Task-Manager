'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';

type Role = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  permissions: string[];
};

type UserRole = {
  roleId: string;
  grantedAt: string;
  grantedBy: string | null;
  role: { name: string; isBuiltin: boolean };
};

async function apiDelete(path: string): Promise<unknown> {
  const res = await fetch(`/api/proxy/${path}`, { method: 'DELETE' });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    type ErrBody = { message?: string | string[] };
    const eb = body as ErrBody | null;
    const msg = Array.isArray(eb?.message) ? eb.message.join(', ') : (eb?.message ?? res.statusText);
    throw new ApiError(msg, res.status, body);
  }
  return body;
}

export function RolesSection({ userId }: { userId: string }) {
  const t = useTranslations('profile.roles');
  const qc = useQueryClient();

  // Both queries 403 silently if the viewer lacks role.manage — we hide the
  // whole section rather than showing an error.
  const { data: roles, isError: rolesErr } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('roles'),
    retry: false,
  });
  const { data: granted, isError: grantedErr } = useQuery<UserRole[]>({
    queryKey: ['user', userId, 'roles'],
    queryFn: () => api.get(`users/${userId}/roles`),
    retry: false,
  });

  const grant = useMutation({
    mutationFn: (roleId: string) =>
      api.post<UserRole>(`users/${userId}/roles`, { roleId }),
    onSuccess: () => {
      toast.success(t('toast.granted'));
      qc.invalidateQueries({ queryKey: ['user', userId, 'roles'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });
  const revoke = useMutation({
    mutationFn: (roleId: string) => apiDelete(`users/${userId}/roles/${roleId}`),
    onSuccess: () => {
      toast.success(t('toast.revoked'));
      qc.invalidateQueries({ queryKey: ['user', userId, 'roles'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  if (rolesErr || grantedErr) return null;
  if (!roles || !granted) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const grantedSet = new Set(granted.map((g) => g.roleId));
  const busy = grant.isPending || revoke.isPending;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('heading')}
        </h2>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">{t('description')}</p>
      <ul className="divide-y rounded-md border">
        {roles.map((r) => {
          const isGranted = grantedSet.has(r.id);
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.name}</span>
                  {r.isBuiltin && <Badge variant="outline">{t('builtin')}</Badge>}
                </div>
                {r.description && (
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={isGranted}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.checked) grant.mutate(r.id);
                    else revoke.mutate(r.id);
                  }}
                  className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  {isGranted ? t('granted') : t('notGranted')}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
