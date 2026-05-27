'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError, type Department, type Team } from '@/lib/api';
import { RichTextEditor } from '../../../new/_components/rich-text-editor';
import { TagPicker } from '../../../_components/tag-picker';

type Tag = { id: string; name: string; color: string | null; categoryId: string };
type TaskTagRow = { tagId: string; tag: Tag };
type MyPerms = { permissions: string[] };

function hasPerm(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}

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

type Priority = 'low' | 'medium' | 'high' | 'urgent';

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: string | null;
  status: TaskStatus;
  departmentId: string;
  teamId: string | null;
  branchId: string | null;
  taskTags?: TaskTagRow[];
};

const EDITABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(['draft', 'assigned']);
const NONE = '__none__';

export function EditTaskForm({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.edit');
  const tNew = useTranslations('tasks.new');
  const tStatus = useTranslations('tasks.status');
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: task, isLoading, error } = useQuery<Task, ApiError>({
    queryKey: ['task', taskId],
    queryFn: () => api.get<Task>(`tasks/${taskId}`),
    retry: (count, err) => err.status !== 404 && err.status !== 403 && count < 2,
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });
  const { data: teams } = useQuery<Team[]>({
    queryKey: ['teams', { status: 'active' }],
    queryFn: () => api.get('teams?status=active'),
  });

  // Form state — initialised from the loaded task once it arrives.
  const [title, setTitle] = useState('');
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState<string>(NONE);
  const [tags, setTags] = useState<Tag[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: perms } = useQuery<MyPerms>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
  });
  const canCreateTags = hasPerm(perms?.permissions ?? [], 'tag.create');

  // Seed form state once on first successful load.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!task || seeded) return;
    setTitle(task.title);
    setDescriptionHtml(task.description ?? '');
    setPriority(task.priority);
    setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setDepartmentId(task.departmentId);
    setTeamId(task.teamId ?? NONE);
    setTags((task.taskTags ?? []).map((tt) => tt.tag));
    setSeeded(true);
  }, [task, seeded]);

  const update = useMutation({
    mutationFn: async ({
      patch,
      tagIds,
    }: {
      patch: Record<string, unknown>;
      tagIds: string[];
    }) => {
      await api.patch(`tasks/${taskId}`, patch);
      // PUT replaces the full tag set. Sent unconditionally so a user
      // clearing tags is honoured.
      await api.put(`tasks/${taskId}/tags`, { tagIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.push(`/tasks/${taskId}`);
    },
    onError: (err: ApiError) => {
      setSubmitError(err.message || t('errors.generic'));
    },
  });

  if (isLoading) {
    return <p className="text-muted-foreground">{t('loading')}</p>;
  }

  if (error?.status === 404 || error?.status === 403) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{tNew('errors.generic')}</h1>
        <Button asChild variant="outline">
          <Link href="/tasks">{t('back')}</Link>
        </Button>
      </div>
    );
  }
  if (error || !task) {
    return <p className="text-destructive">{t('loadError')}</p>;
  }

  // The hard gate: editing past 'assigned' is rejected with 409 server-side.
  // We surface that as a friendly lock screen rather than letting the user
  // type into a form that will fail on submit.
  if (!EDITABLE_STATUSES.has(task.status)) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="font-semibold">{t('locked.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('locked.body')}</p>
          <p className="mt-2 text-sm">
            {t('locked.statusLabel')}:{' '}
            <span className="font-medium">
              {tStatus(task.status as 'draft')}
            </span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/tasks/${taskId}`}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const teamsForDept = (teams ?? []).filter((tm) => tm.departmentId === departmentId);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!title.trim()) return setSubmitError(tNew('errors.titleRequired'));
    if (!departmentId) return setSubmitError(tNew('errors.departmentRequired'));

    const body: Record<string, unknown> = {
      title: title.trim(),
      priority,
      departmentId,
    };
    const cleanDesc = descriptionHtml.replace(/<p>\s*<\/p>/g, '').trim();
    body.description = cleanDesc ? descriptionHtml : null;
    body.dueDate = dueDate ? new Date(dueDate).toISOString() : null;
    body.teamId = teamId === NONE ? null : teamId;
    update.mutate({ patch: body, tagIds: tags.map((tg) => tg.id) });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Field label={tNew('fields.title')} required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tNew('fields.titlePlaceholder')}
          maxLength={200}
          autoFocus
        />
      </Field>

      <Field label={tNew('fields.description')}>
        <RichTextEditor
          value={descriptionHtml}
          onChange={setDescriptionHtml}
          placeholder={tNew('fields.descriptionPlaceholder')}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={tNew('fields.priority')}>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {tNew(`priority.${p}` as 'priority.low')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={tNew('fields.dueDate')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>

        <Field label={tNew('fields.department')} required>
          <Select
            value={departmentId}
            onValueChange={(v) => {
              setDepartmentId(v);
              setTeamId(NONE);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={tNew('fields.departmentPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={tNew('fields.team')}>
          <Select value={teamId} onValueChange={setTeamId} disabled={!departmentId}>
            <SelectTrigger>
              <SelectValue placeholder={tNew('fields.teamPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tNew('fields.noTeam')}</SelectItem>
              {teamsForDept.map((tm) => (
                <SelectItem key={tm.id} value={tm.id}>
                  {tm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label={tNew('fields.tags')}>
        <TagPicker selected={tags} onChange={setTags} canCreate={canCreateTags} />
      </Field>

      {submitError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="ghost" type="button">
          <Link href={`/tasks/${taskId}`}>{t('cancel')}</Link>
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="ms-1 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

