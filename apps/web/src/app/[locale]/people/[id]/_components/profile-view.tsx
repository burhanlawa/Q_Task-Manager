'use client';

import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { ChevronLeft, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type Branch, type Department, ApiError } from '@/lib/api';

type UserDetail = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phone: string | null;
  avatarFileId: string | null;
  locale: string;
  timezone: string | null;
  orgRole: string;
  status: string;
  employmentStatus: string;
  branchId: string | null;
  departmentId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Present only when fetched with ?include=sensitive
  dateOfBirth?: string | null;
  nationalId?: string | null;
};

export function ProfileView({ userId }: { userId: string }) {
  const t = useTranslations('profile');
  const [showSensitive, setShowSensitive] = useState(false);

  const queryUrl = showSensitive ? `users/${userId}?include=sensitive` : `users/${userId}`;

  const { data: user, isLoading, isError, error } = useQuery<UserDetail>({
    queryKey: ['user', userId, { sensitive: showSensitive }],
    queryFn: () => api.get(queryUrl),
    retry: false,
  });

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches', { status: 'all' }],
    queryFn: () => api.get('branches?status=all'),
  });
  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'all' }],
    queryFn: () => api.get('departments?status=all'),
  });

  const handleReveal = () => {
    setShowSensitive(true);
    // If permission is missing, the query fires + fails. We surface a toast
    // from the error handler below; the showSensitive state stays true so the
    // button still reads "Hide" — clicking it again rolls back.
  };

  if (showSensitive && isError && error instanceof ApiError && error.status === 403) {
    toast.error(t('toast.noPermission'));
    setShowSensitive(false);
  }

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (!user) return <p className="text-destructive">{t('loadError')}</p>;

  const fullName =
    user.displayName ?? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ?? user.email;
  const branchName = user.branchId
    ? (branches?.find((b) => b.id === user.branchId)?.name ?? '—')
    : '—';
  const deptName = user.departmentId
    ? (departments?.find((d) => d.id === user.departmentId)?.name ?? '—')
    : '—';
  const dt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  const dob = user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/people">
          <ChevronLeft className="me-1 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline">{user.orgRole}</Badge>
            <Badge
              variant={
                user.status === 'active'
                  ? 'default'
                  : user.status === 'invited'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {user.status}
            </Badge>
          </div>
        </div>
        {!showSensitive && (
          <Button variant="outline" size="sm" onClick={handleReveal}>
            <Eye className="me-2 h-4 w-4" />
            {t('revealSensitive')}
          </Button>
        )}
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sections.basic')}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border p-4 sm:grid-cols-2">
          <Field label={t('fields.phone')} value={user.phone ?? '—'} />
          <Field label={t('fields.locale')} value={user.locale} />
          <Field label={t('fields.timezone')} value={user.timezone ?? '—'} />
          <Field label={t('fields.employmentStatus')} value={user.employmentStatus} />
          <Field label={t('fields.branch')} value={branchName} />
          <Field label={t('fields.department')} value={deptName} />
          <Field label={t('fields.lastLogin')} value={dt(user.lastLoginAt)} />
          <Field label={t('fields.createdAt')} value={dt(user.createdAt)} />
        </dl>
      </section>

      {showSensitive && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('sections.sensitive')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 sm:grid-cols-2">
            <Field label={t('fields.dateOfBirth')} value={dob ?? '—'} />
            <Field label={t('fields.nationalId')} value={user.nationalId ?? '—'} mono />
          </dl>
          <p className="text-xs text-muted-foreground">{t('sensitiveNotice')}</p>
        </section>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  );
}
