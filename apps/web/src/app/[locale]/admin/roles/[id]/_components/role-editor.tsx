'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

type Role = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  permissions: string[];
};

type PermissionGroup = {
  category: string;
  description: string;
  permissions: { key: string; label: string }[];
};

const WILDCARD = '*';

export function RoleEditor({ roleId }: { roleId: string }) {
  const t = useTranslations('admin.roles');
  const qc = useQueryClient();
  const [wildcard, setWildcard] = useState(false);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const { data: role, isLoading: roleLoading } = useQuery<Role>({
    queryKey: ['role', roleId],
    queryFn: () => api.get(`roles/${roleId}`),
  });
  const { data: catalog, isLoading: catLoading } = useQuery<{ groups: PermissionGroup[] }>({
    queryKey: ['permission-catalog'],
    queryFn: () => api.get('roles/permission-catalog'),
  });

  useEffect(() => {
    if (role) {
      const perms = new Set(role.permissions);
      setWildcard(perms.has(WILDCARD));
      perms.delete(WILDCARD);
      setGranted(perms);
      setDirty(false);
    }
  }, [role]);

  const save = useMutation({
    mutationFn: () => {
      const permissions = wildcard
        ? [WILDCARD]
        : [...granted].sort();
      return api.patch<Role>(`roles/${roleId}`, { permissions });
    },
    onSuccess: () => {
      toast.success(t('toast.saved'));
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['role', roleId] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  if (roleLoading || catLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (!role || !catalog) return <p className="text-destructive">{t('loadError')}</p>;

  const toggle = (key: string) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const toggleWildcard = (v: boolean) => {
    setWildcard(v);
    setDirty(true);
  };

  // Show keys that exist on the role but not in the catalog separately so
  // edits don't silently drop them.
  const catalogKeys = new Set(catalog.groups.flatMap((g) => g.permissions.map((p) => p.key)));
  const unknownKeys = [...granted].filter((k) => !catalogKeys.has(k));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/roles">
          <ChevronLeft className="me-1 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
          {role.isBuiltin && <Badge variant="outline">{t('builtin')}</Badge>}
        </div>
        {role.description && (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        )}
      </header>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={wildcard}
            onChange={(e) => toggleWildcard(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t('wildcard')}</span>
            <span className="text-xs text-muted-foreground">{t('wildcardHelp')}</span>
          </div>
        </label>
      </div>

      <fieldset disabled={wildcard} className="space-y-6 disabled:opacity-50">
        {catalog.groups.map((g) => (
          <section key={g.category} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.category}
              </h2>
              <p className="text-xs text-muted-foreground">{g.description}</p>
            </div>
            <ul className="divide-y rounded-md border">
              {g.permissions.map((p) => (
                <li key={p.key} className="flex items-start justify-between gap-3 p-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{p.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={granted.has(p.key)}
                    onChange={() => toggle(p.key)}
                    className="mt-1 h-4 w-4 cursor-pointer rounded border-input accent-primary"
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </fieldset>

      {unknownKeys.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('unknownKeysHeading')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('unknownKeysHelp')}</p>
          <ul className="rounded-md border bg-muted/30 p-3">
            {unknownKeys.map((k) => (
              <li key={k} className="font-mono text-xs">
                {k}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-4 flex items-center justify-end gap-2">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {save.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </div>
  );
}
