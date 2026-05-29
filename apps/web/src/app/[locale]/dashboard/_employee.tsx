'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CircleCheck,
  ListChecks,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type ActiveByStatus = {
  draft: number;
  assigned: number;
  in_progress: number;
  submitted: number;
  reassignment_requested: number;
  total: number;
};
type DeadlineRow = { id: string; title: string; status: string; priority: string; dueDate: string };
type OverdueRow = DeadlineRow & { daysOverdue: number };
type Notification = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
type Stats = {
  assignedLast30: number;
  completedLast30: number;
  onTimePctLast30: number | null;
};
type Response = {
  activeByStatus: ActiveByStatus;
  upcomingDeadlines: DeadlineRow[];
  overdue: OverdueRow[];
  recentNotifications: Notification[];
  stats: Stats;
};

export function EmployeeDashboard() {
  const t = useTranslations('dashboard.employee');
  const locale = useLocale();

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['dashboard', 'employee'],
    queryFn: () => api.get('dashboard/employee'),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-muted-foreground">{t('loadError')}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ActiveTasksCard data={data.activeByStatus} t={t} />
      <StatsCard data={data.stats} t={t} />
      <UpcomingCard data={data.upcomingDeadlines} t={t} locale={locale} />
      <OverdueCard data={data.overdue} t={t} locale={locale} />
      <NotificationsCard
        data={data.recentNotifications}
        t={t}
        locale={locale}
      />
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

function ActiveTasksCard({
  data,
  t,
}: {
  data: ActiveByStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  const statuses = ['draft', 'assigned', 'in_progress', 'submitted', 'reassignment_requested'] as const;
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={ListChecks} label={t('cards.active')} />
      {data.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('active.none')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-3xl font-semibold tabular-nums">{data.total}</p>
          <p className="text-xs text-muted-foreground">
            {t('active.total', { count: data.total })}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {statuses.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <span className="text-muted-foreground">{t(`active.${s}`)}</span>
                <span className="tabular-nums">{data[s]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatsCard({
  data,
  t,
}: {
  data: Stats;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={CircleCheck} label={t('cards.stats')} />
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t('stats.assigned')}</p>
          <p className="text-2xl font-semibold tabular-nums">{data.assignedLast30}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('stats.completed')}</p>
          <p className="text-2xl font-semibold tabular-nums">{data.completedLast30}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('stats.onTime')}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {data.onTimePctLast30 === null ? t('stats.onTimeNone') : `${data.onTimePctLast30}%`}
          </p>
        </div>
      </div>
    </section>
  );
}

function UpcomingCard({
  data,
  t,
  locale,
}: {
  data: DeadlineRow[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={CalendarClock} label={t('cards.upcoming')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('upcoming.none')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((row) => (
            <li key={row.id}>
              <Link
                href={`/tasks/${row.id}` as never}
                className="block rounded-md px-2 py-1.5 hover:bg-secondary/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{row.title}</span>
                  <PriorityBadge priority={row.priority} t={t} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('upcoming.due', { date: formatDate(row.dueDate, locale) })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverdueCard({
  data,
  t,
  locale,
}: {
  data: OverdueRow[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={AlertTriangle} label={t('cards.overdue')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('overdue.none')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((row) => (
            <li key={row.id}>
              <Link
                href={`/tasks/${row.id}` as never}
                className="block rounded-md px-2 py-1.5 hover:bg-secondary/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{row.title}</span>
                  <PriorityBadge priority={row.priority} t={t} />
                </div>
                <p className="mt-0.5 text-xs text-destructive">
                  {t('overdue.days', { count: row.daysOverdue })}
                  <span className="ms-2 text-muted-foreground">
                    {formatDate(row.dueDate, locale)}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotificationsCard({
  data,
  t,
  locale,
}: {
  data: Notification[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 md:col-span-2">
      <CardHeader icon={Bell} label={t('cards.notifications')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('notifications.none')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {data.map((n) => (
            <li key={n.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  {!n.readAt && (
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <span className="font-medium">{n.title ?? n.type}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt, locale)}
                </span>
              </div>
              {n.body && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {n.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PriorityBadge({
  priority,
  t,
}: {
  priority: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const tone = {
    low: 'bg-muted text-muted-foreground',
    medium: 'bg-secondary text-secondary-foreground',
    high: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    urgent: 'bg-destructive/20 text-destructive',
  }[priority] ?? 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
