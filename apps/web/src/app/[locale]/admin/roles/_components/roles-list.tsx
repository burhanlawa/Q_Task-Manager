'use client';

import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

type Role = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  permissions: string[];
};

export function RolesList() {
  const t = useTranslations('admin.roles');
  const { data: roles, isLoading, isError } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('roles'),
  });

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (isError || !roles) return <p className="text-destructive">{t('loadError')}</p>;
  if (roles.length === 0) return <p className="text-muted-foreground">{t('empty')}</p>;

  return (
    <ul className="divide-y rounded-md border">
      {roles.map((r) => (
        <li key={r.id}>
          <Link
            href={`/admin/roles/${r.id}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-muted/50"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{r.name}</span>
                {r.isBuiltin && <Badge variant="outline">{t('builtin')}</Badge>}
                {r.permissions.includes('*') && (
                  <Badge variant="secondary">{t('wildcard')}</Badge>
                )}
              </div>
              {r.description && (
                <p className="text-xs text-muted-foreground">{r.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('permissionCount', { count: r.permissions.length })}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
