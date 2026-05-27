'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError, type Department } from '@/lib/api';

type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'reassignment_requested'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

type Assignee = { userId: string; assignedAt: string };

type Task = {
  id: string;
  companyId: string;
  branchId: string | null;
  departmentId: string;
  teamId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  createdByUserId: string;
  assignedToUserId: string | null;
  assigneeCount: number;
  reassignmentRequestCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  assignees: Assignee[];
};

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  assigned: 'default',
  in_progress: 'default',
  submitted: 'secondary',
  reassignment_requested: 'secondary',
  approved: 'default',
  rejected: 'destructive',
  completed: 'default',
  cancelled: 'outline',
};

// Action buttons are stubbed for Sprint 8.10 — they'll be wired to the
// transition endpoints (POST :id/accept etc.) in Sprint 9. Which buttons
// are visible depends on the task's status, but for now we just render
// every state-machine action as a disabled button so the UI shape is set.
const ACTIONS_BY_STATUS: Record<TaskStatus, readonly string[]> = {
  draft: [],
  assigned: ['accept', 'requestReassignment', 'cancel'],
  in_progress: ['submit', 'requestReassignment', 'cancel'],
  submitted: ['approve', 'requestRevision', 'cancel'],
  reassignment_requested: ['decideReassignment', 'cancel'],
  approved: [],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function TaskDetail({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks');

  const { data: task, isLoading, error } = useQuery<Task, ApiError>({
    queryKey: ['task', taskId],
    queryFn: () => api.get<Task>(`tasks/${taskId}`),
    retry: (count, err) => {
      // Don't retry on 404/403 — those mean the task is genuinely unreachable
      // for this user (different tenant, archived, or doesn't exist).
      if (err.status === 404 || err.status === 403) return false;
      return count < 2;
    },
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });

  if (isLoading) {
    return <p className="text-muted-foreground">{t('loading')}</p>;
  }

  if (error?.status === 404 || error?.status === 403) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
        <p className="text-muted-foreground">{t('notFound.body')}</p>
        <Button asChild variant="outline">
          <Link href="/tasks">{t('notFound.back')}</Link>
        </Button>
      </div>
    );
  }

  if (error || !task) {
    return <p className="text-destructive">{t('loadError')}</p>;
  }

  const dept = departments?.find((d) => d.id === task.departmentId);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/tasks"
          className="text-sm text-muted-foreground hover:underline"
        >
          {t('backToList')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <Badge variant={STATUS_VARIANT[task.status]}>
            {t(`status.${task.status}` as 'status.draft')}
          </Badge>
        </div>
      </div>

      <section className="rounded-md border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t('detail.overview')}
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label={t('detail.priority')}>
            <Badge variant="outline">
              {t(`priority.${task.priority}` as 'priority.low')}
            </Badge>
          </Field>
          <Field label={t('detail.department')}>{dept?.name ?? '—'}</Field>
          <Field label={t('detail.dueDate')}>
            {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
          </Field>
          <Field label={t('detail.created')}>
            {new Date(task.createdAt).toLocaleString()}
          </Field>
          <Field label={t('detail.updated')}>
            {new Date(task.updatedAt).toLocaleString()}
          </Field>
          <Field label={t('detail.assignees')}>
            {task.assigneeCount} {task.assigneeCount === 1 ? t('detail.person') : t('detail.people')}
          </Field>
        </dl>
      </section>

      {task.description && (
        <section className="rounded-md border p-5 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t('detail.description')}
          </h2>
          <p className="whitespace-pre-wrap text-sm">{task.description}</p>
        </section>
      )}

      <section className="rounded-md border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t('detail.actions')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('detail.actionsSoon')}</p>
        <div className="flex flex-wrap gap-2">
          {ACTIONS_BY_STATUS[task.status].map((action) => (
            <Button key={action} variant="outline" disabled>
              {t(`actions.${action}` as 'actions.accept')}
            </Button>
          ))}
          {ACTIONS_BY_STATUS[task.status].length === 0 && (
            <span className="text-sm text-muted-foreground">{t('detail.noActions')}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
