'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { AssigneePicker } from './assignee-picker';
import { RichTextEditor } from './rich-text-editor';

type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  departmentId: string | null;
};

type Priority = 'low' | 'medium' | 'high' | 'urgent';

const NONE = '__none__';

export function CreateTaskForm() {
  const t = useTranslations('tasks.new');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState<string>(NONE);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });

  const { data: teams } = useQuery<Team[]>({
    queryKey: ['teams', { status: 'active' }],
    queryFn: () => api.get('teams?status=active'),
  });

  // Pull the active people directory. The picker filters client-side. Single
  // tenant => list is small enough for v1; we'll paginate if it ever bites.
  const { data: users } = useQuery<User[]>({
    queryKey: ['users', { status: 'active' }],
    queryFn: () => api.get('users?status=active'),
  });

  // Teams filtered to the chosen department — picking a team from a sibling
  // department gets rejected by the API anyway.
  const teamsForDept = (teams ?? []).filter((tm) => tm.departmentId === departmentId);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('tasks', body),
    onSuccess: (task: unknown) => {
      const id = (task as { id: string }).id;
      router.push(`/tasks/${id}`);
    },
    onError: (err: ApiError) => {
      setSubmitError(err.message || t('errors.generic'));
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError(t('errors.titleRequired'));
      return;
    }
    if (!departmentId) {
      setSubmitError(t('errors.departmentRequired'));
      return;
    }
    const body: Record<string, unknown> = {
      title: title.trim(),
      departmentId,
      priority,
    };
    // The description editor produces "<p></p>" when empty — only send real content.
    const cleanDesc = descriptionHtml.replace(/<p>\s*<\/p>/g, '').trim();
    if (cleanDesc) body.description = descriptionHtml;
    if (dueDate) body.dueDate = new Date(dueDate).toISOString();
    if (teamId !== NONE) body.teamId = teamId;
    if (assigneeIds.length > 0) body.assigneeUserIds = assigneeIds;
    create.mutate(body);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Title */}
      <Field label={t('fields.title')} required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('fields.titlePlaceholder')}
          maxLength={200}
          autoFocus
        />
      </Field>

      {/* Description (rich text) */}
      <Field label={t('fields.description')}>
        <RichTextEditor
          value={descriptionHtml}
          onChange={setDescriptionHtml}
          placeholder={t('fields.descriptionPlaceholder')}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Priority */}
        <Field label={t('fields.priority')}>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`priority.${p}` as 'priority.low')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Due date */}
        <Field label={t('fields.dueDate')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>

        {/* Department */}
        <Field label={t('fields.department')} required>
          <Select
            value={departmentId}
            onValueChange={(v) => {
              setDepartmentId(v);
              setTeamId(NONE);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('fields.departmentPlaceholder')} />
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

        {/* Team */}
        <Field label={t('fields.team')}>
          <Select
            value={teamId}
            onValueChange={(v) => setTeamId(v)}
            disabled={!departmentId}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('fields.teamPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('fields.noTeam')}</SelectItem>
              {teamsForDept.map((tm) => (
                <SelectItem key={tm.id} value={tm.id}>
                  {tm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Assignees */}
      <Field label={t('fields.assignees')}>
        <AssigneePicker
          users={users ?? []}
          selectedIds={assigneeIds}
          onChange={setAssigneeIds}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('fields.assigneesHint')}</p>
      </Field>

      {/* Tags placeholder */}
      <Field label={t('fields.tags')}>
        <Input disabled placeholder={t('fields.tagsPlaceholder')} />
        <p className="mt-1 text-xs text-muted-foreground">{t('fields.tagsSoon')}</p>
      </Field>

      {submitError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="ghost" type="button">
          <Link href="/tasks">{t('cancel')}</Link>
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('submitting') : t('submit')}
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
