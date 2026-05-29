'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarClock,
  ListChecks,
  UserCheck,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Scope = { kind: 'company' | 'department' | 'teams' };
type TeamRow = { teamId: string; teamName: string; openCount: number; completedLast30: number };
type Deadline = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  assigneeName: string | null;
};
type WorkloadRow = {
  userId: string;
  displayName: string | null;
  openCount: number;
  weightedLoad: number;
};
type Response = {
  scope: Scope;
  taskOverview: { total: number; byStatus: Record<string, number> };
  teamComparison: TeamRow[];
  upcomingDeadlines: Deadline[];
  workloadTop: WorkloadRow[];
  pendingApprovals: number;
};

export function ManagerDashboard() {
  const t = useTranslations('dashboard.manager');
  const locale = useLocale();

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['dashboard', 'manager'],
    queryFn: () => api.get('dashboard/manager'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (error || !data) return <p className="text-sm text-muted-foreground">{t('loadError')}</p>;

  const teamCount = data.teamComparison.length;
  const scopeLabel =
    data.scope.kind === 'company'
      ? t('scope.company')
      : data.scope.kind === 'department'
        ? t('scope.department')
        : teamCount === 0
          ? t('scope.noScope')
          : t('scope.teams', { count: teamCount });

  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {scopeLabel}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <OverviewCard data={data.taskOverview} t={t} />
        <ApprovalsCard count={data.pendingApprovals} t={t} />
        <TeamComparisonCard data={data.teamComparison} t={t} />
        <WorkloadCard data={data.workloadTop} t={t} />
        <UpcomingDeadlinesCard data={data.upcomingDeadlines} t={t} locale={locale} />
      </div>
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

function OverviewCard({
  data,
  t,
}: {
  data: { total: number; byStatus: Record<string, number> };
  t: ReturnType<typeof useTranslations>;
}) {
  const order = [
    'draft',
    'assigned',
    'in_progress',
    'submitted',
    'reassignment_requested',
    'completed',
  ];
  const rows = order
    .map((status) => ({ status, count: data.byStatus[status] ?? 0 }))
    .filter((r) => r.count > 0);
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={ListChecks} label={t('cards.overview')} />
      {data.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('overview.none')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-3xl font-semibold tabular-nums">{data.total}</p>
          <p className="text-xs text-muted-foreground">
            {t('overview.total', { count: data.total })}
          </p>
          {rows.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {rows.map((r) => (
                <li key={r.status} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t(`overview.status.${r.status}`)}</span>
                  <span className="tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function TeamComparisonCard({
  data,
  t,
}: {
  data: TeamRow[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={Building2} label={t('cards.teamComparison')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('teamComparison.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start font-medium">
                  {t('teamComparison.cols.team')}
                </th>
                <th className="px-2 py-1.5 text-end font-medium">
                  {t('teamComparison.cols.open')}
                </th>
                <th className="px-2 py-1.5 text-end font-medium">
                  {t('teamComparison.cols.completed30')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.teamId} className="border-b last:border-b-0">
                  <td className="px-2 py-1.5">{row.teamName}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{row.openCount}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{row.completedLast30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UpcomingDeadlinesCard({
  data,
  t,
  locale,
}: {
  data: Deadline[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 md:col-span-2">
      <CardHeader icon={CalendarClock} label={t('cards.upcoming')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('upcoming.empty')}</p>
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
                  <PriorityBadge priority={row.priority} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('upcoming.due', { date: formatDate(row.dueDate, locale) })}
                  <span className="ms-2">
                    {row.assigneeName
                      ? t('upcoming.assignedTo', { name: row.assigneeName })
                      : t('upcoming.noAssignee')}
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

function WorkloadCard({
  data,
  t,
}: {
  data: WorkloadRow[];
  t: ReturnType<typeof useTranslations>;
}) {
  const max = Math.max(1, ...data.map((r) => r.weightedLoad));
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={Users} label={t('cards.workload')} />
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('workload.empty')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((row) => {
            const pct = Math.round((row.weightedLoad / max) * 100);
            return (
              <li key={row.userId} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{row.displayName ?? row.userId}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {t('workload.load', { load: row.weightedLoad })} ·{' '}
                    {t('workload.open', { count: row.openCount })}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ApprovalsCard({
  count,
  t,
}: {
  count: number;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <CardHeader icon={UserCheck} label={t('cards.approvals')} />
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">{t('approvals.none')}</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{count}</p>
            <p className="text-xs text-muted-foreground">
              {t('approvals.count', { count })}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/onboarding/approvals">{t('approvals.review')}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const tone =
    {
      low: 'bg-muted text-muted-foreground',
      medium: 'bg-secondary text-secondary-foreground',
      high: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
      urgent: 'bg-destructive/20 text-destructive',
    }[priority] ?? 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}
    >
      {priority}
    </span>
  );
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}
