'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CreditCard,
  KeyRound,
  ShieldAlert,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/api';

type Health = {
  totalUsers: number;
  activeUsers: number;
  invitedUsers: number;
  suspendedUsers: number;
  tasksOpen: number;
  tasksCompletedLast30: number;
  storageUsedBytes: string;
};
type Subscription = {
  plan: string;
  status: string;
  daysSinceJoined: number;
  storageUsedBytes: string;
};
type SecurityAlert = {
  id: string;
  createdAt: string;
  actionType: string;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  fieldChanged: string | null;
};
type PermissionChange = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
};
type Response = {
  systemHealth: Health;
  subscription: Subscription;
  securityAlerts: SecurityAlert[];
  recentPermissionChanges: PermissionChange[];
};

export function AdminDashboard() {
  const t = useTranslations('dashboard.admin');
  const locale = useLocale();

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => api.get('dashboard/admin'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (error || !data) return <p className="text-sm text-muted-foreground">{t('loadError')}</p>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <HealthCard data={data.systemHealth} t={t} />
      <SubscriptionCard data={data.subscription} t={t} />
      <SecurityCard data={data.securityAlerts} t={t} locale={locale} />
      <PermissionChangesCard data={data.recentPermissionChanges} t={t} locale={locale} />
    </div>
  );
}

function CardHeader({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}

function HealthCard({
  data,
  t,
}: {
  data: Health;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={Activity} label={t('cards.health')} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label={t('health.totalUsers')} value={data.totalUsers} />
        <Stat label={t('health.activeUsers')} value={data.activeUsers} />
        <Stat label={t('health.invitedUsers')} value={data.invitedUsers} />
        <Stat label={t('health.suspendedUsers')} value={data.suspendedUsers} />
        <Stat label={t('health.tasksOpen')} value={data.tasksOpen} />
        <Stat label={t('health.tasksCompleted30')} value={data.tasksCompletedLast30} />
        <Stat
          label={t('health.storageUsed')}
          value={formatBytes(data.storageUsedBytes)}
          span={2}
        />
      </div>
    </section>
  );
}

function SubscriptionCard({
  data,
  t,
}: {
  data: Subscription;
  t: ReturnType<typeof useTranslations>;
}) {
  // Map enum keys to translated labels with a graceful fallback when the
  // server returns a value the client doesn't know about (forward-compat).
  const planLabel = safeT(t, `plans.${data.plan}`, data.plan);
  const statusLabel = safeT(t, `statuses.${data.status}`, data.status);
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={CreditCard} label={t('cards.subscription')} />
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('subscription.plan')}</dt>
          <dd className="font-medium">{planLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('subscription.status')}</dt>
          <dd className="font-medium">{statusLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('subscription.storage')}</dt>
          <dd className="font-medium tabular-nums">{formatBytes(data.storageUsedBytes)}</dd>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          {t('subscription.joined', { days: data.daysSinceJoined })}
        </p>
      </dl>
    </section>
  );
}

function SecurityCard({
  data,
  t,
  locale,
}: {
  data: SecurityAlert[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 md:col-span-2">
      <CardHeader icon={ShieldAlert} label={t('cards.security')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('security.none')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {data.map((a) => {
            const label = safeT(t, `security.actions.${a.actionType}`, a.actionType);
            return (
              <li key={a.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div>
                    <span className="font-medium">{label}</span>
                    <span className="ms-2 text-xs text-muted-foreground">
                      {a.actorName
                        ? t('security.byActor', { name: a.actorName })
                        : t('security.byUnknown')}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(a.createdAt, locale)}
                  </span>
                </div>
                {(a.targetType || a.fieldChanged) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[a.targetType, a.fieldChanged].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PermissionChangesCard({
  data,
  t,
  locale,
}: {
  data: PermissionChange[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 md:col-span-2">
      <CardHeader icon={KeyRound} label={t('cards.permissions')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('permissions.none')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {data.map((p) => {
            const label = safeT(t, `security.actions.${p.actionType}`, p.actionType);
            return (
              <li key={p.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div>
                    <span className="font-medium">{label}</span>
                    <span className="ms-2 text-xs text-muted-foreground">
                      {p.actorName
                        ? t('security.byActor', { name: p.actorName })
                        : t('security.byUnknown')}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(p.createdAt, locale)}
                  </span>
                </div>
                {hasMetadata(p.metadata) && (
                  <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
                    {JSON.stringify(p.metadata, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  span,
}: {
  label: string;
  value: number | string;
  span?: number;
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// next-intl throws on missing keys; we catch + fall back so unknown
// action types / plan / status values from a future API still render.
function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    return t(key);
  } catch {
    return fallback;
  }
}

// Narrow unknown → "has keys" without leaning on `as object` casts that
// confuse newer TS lints.
function hasMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

function formatBytes(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
