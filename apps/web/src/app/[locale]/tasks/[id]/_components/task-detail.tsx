'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError, type Department } from '@/lib/api';
import { RequestReassignmentDialog } from './request-reassignment-dialog';

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

type Me = { id: string };
type MyPerms = { permissions: string[] };

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

// One row per transition. The button only renders when both `visible` and
// the status precondition pass; the server remains the source of truth and
// will 403/409 if a stale UI somehow shows a button it shouldn't.
type Action = {
  key: 'accept' | 'start' | 'submit' | 'approve' | 'requestRevision' | 'cancel';
  endpoint: string; // POST /tasks/:id/<endpoint>
  fromStatus: TaskStatus[];
  // `actor` decides who sees the button:
  //   'assignee'         → the viewer must be on the task_assignees list
  //   'creatorOrPerm'    → viewer is the creator OR holds the permission key
  actor:
    | { type: 'assignee' }
    | { type: 'creatorOrPerm'; permission: string };
  variant?: 'outline' | 'destructive' | 'default';
};

const ACTIONS: readonly Action[] = [
  {
    key: 'accept',
    endpoint: 'accept',
    fromStatus: ['assigned'],
    actor: { type: 'assignee' },
  },
  {
    key: 'start',
    endpoint: 'start',
    fromStatus: ['assigned'],
    actor: { type: 'assignee' },
    variant: 'outline',
  },
  {
    key: 'submit',
    endpoint: 'submit',
    fromStatus: ['in_progress'],
    actor: { type: 'assignee' },
  },
  {
    key: 'approve',
    endpoint: 'approve',
    fromStatus: ['submitted'],
    actor: { type: 'creatorOrPerm', permission: 'task.approve' },
  },
  {
    key: 'requestRevision',
    endpoint: 'request-revision',
    fromStatus: ['submitted'],
    actor: { type: 'creatorOrPerm', permission: 'task.approve' },
    variant: 'outline',
  },
  {
    key: 'cancel',
    endpoint: 'cancel',
    fromStatus: [
      'draft',
      'assigned',
      'in_progress',
      'submitted',
      'reassignment_requested',
      'approved',
      'rejected',
    ],
    actor: { type: 'creatorOrPerm', permission: 'task.cancel' },
    variant: 'destructive',
  },
];

function isAssigneeOf(task: Task, userId: string): boolean {
  if (task.assignedToUserId === userId) return true;
  return task.assignees.some((a) => a.userId === userId);
}

function hasPerm(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks');
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);

  const { data: task, isLoading, error } = useQuery<Task, ApiError>({
    queryKey: ['task', taskId],
    queryFn: () => api.get<Task>(`tasks/${taskId}`),
    retry: (count, err) => {
      if (err.status === 404 || err.status === 403) return false;
      return count < 2;
    },
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });
  const { data: perms } = useQuery<MyPerms>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
  });

  // One transition mutation, parameterised by endpoint. We update the cache
  // optimistically with the server's response so the status badge + actions
  // refresh without a separate GET.
  const transition = useMutation({
    mutationFn: (endpoint: string) => api.post<Task>(`tasks/${taskId}/${endpoint}`, {}),
    onSuccess: (updated) => {
      queryClient.setQueryData(['task', taskId], updated);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setActionError(null);
    },
    onError: (err: ApiError) => {
      setActionError(err.message || t('detail.transitionError'));
    },
  });

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;

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
  if (error || !task) return <p className="text-destructive">{t('loadError')}</p>;

  const dept = departments?.find((d) => d.id === task.departmentId);
  const myId = me?.id ?? '';
  const myPerms = perms?.permissions ?? [];

  // Filter the action list to what this viewer can actually do right now.
  const visibleActions = ACTIONS.filter((a) => {
    if (!a.fromStatus.includes(task.status)) return false;
    if (a.actor.type === 'assignee') {
      return isAssigneeOf(task, myId);
    }
    // creatorOrPerm
    return task.createdByUserId === myId || hasPerm(myPerms, a.actor.permission);
  });

  // A confirm() prompt for the destructive ones — these are reversible only by
  // re-doing the workflow, so a single tap shouldn't fire them by accident.
  const needsConfirm = (key: Action['key']) => key === 'cancel' || key === 'requestRevision';

  // Reassignment is an assignee-side action available while the task is
  // active (assigned/in_progress). It's a separate button because it opens
  // a modal for the required reason rather than firing immediately.
  const canRequestReassignment =
    isAssigneeOf(task, myId) && (task.status === 'assigned' || task.status === 'in_progress');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/tasks" className="text-sm text-muted-foreground hover:underline">
          {t('backToList')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[task.status]}>
              {t(`status.${task.status}` as 'status.draft')}
            </Badge>
            {(task.status === 'draft' || task.status === 'assigned') && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/tasks/${task.id}/edit`}>{t('detail.edit')}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-md border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t('detail.overview')}
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label={t('detail.priority')}>
            <Badge variant="outline">{t(`priority.${task.priority}` as 'priority.low')}</Badge>
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
            {task.assigneeCount}{' '}
            {task.assigneeCount === 1 ? t('detail.person') : t('detail.people')}
          </Field>
        </dl>
      </section>

      {task.description && (
        <section className="rounded-md border p-5 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t('detail.description')}
          </h2>
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            // The description comes from the trusted server (we wrote it via
            // TipTap), but it is still user-generated. Backend should sanitize
            // before storing; we render as HTML here for the rich-text view.
            dangerouslySetInnerHTML={{ __html: task.description }}
          />
        </section>
      )}

      <section className="rounded-md border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t('detail.actions')}
        </h2>
        {actionError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {visibleActions.length === 0 && !canRequestReassignment && (
            <span className="text-sm text-muted-foreground">{t('detail.noActions')}</span>
          )}
          {visibleActions.map((a) => (
            <Button
              key={a.key}
              variant={a.variant ?? 'default'}
              disabled={transition.isPending}
              onClick={() => {
                if (needsConfirm(a.key)) {
                  const ok = window.confirm(t(`detail.confirm.${a.key}` as 'detail.confirm.cancel'));
                  if (!ok) return;
                }
                transition.mutate(a.endpoint);
              }}
            >
              {t(`actions.${a.key}` as 'actions.accept')}
            </Button>
          ))}
          {canRequestReassignment && (
            <Button
              variant="outline"
              disabled={transition.isPending}
              onClick={() => setReassignOpen(true)}
            >
              {t('actions.requestReassignment')}
            </Button>
          )}
        </div>
      </section>

      <RequestReassignmentDialog
        taskId={taskId}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
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
