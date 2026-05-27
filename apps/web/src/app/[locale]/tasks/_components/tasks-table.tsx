'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, type Department } from '@/lib/api';

const ALL_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'submitted',
  'reassignment_requested',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;
type TaskStatus = (typeof ALL_STATUSES)[number];

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  departmentId: string;
  dueDate: string | null;
  createdAt: string;
};

type TasksResponse = { items: Task[]; nextCursor: string | null };

type Me = { id: string };

const ALL = '__all__';

// Status pill colors. We treat `assigned` / `in_progress` as active work
// (default badge), submitted as awaiting decision (secondary), completed
// as the success state, and the cancellations/rejections as muted.
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

export function TasksTable() {
  const t = useTranslations('tasks');
  const [status, setStatus] = useState<TaskStatus | typeof ALL>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [mine, setMine] = useState(false);

  // Pagination is cursor-based. We hold a stack of cursors so "Previous"
  // can jump backwards a page without re-fetching the entire history.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });

  const params = new URLSearchParams();
  if (status !== ALL) params.set('status', status);
  if (departmentId !== ALL) params.set('departmentId', departmentId);
  if (mine && me) params.set('assigneeUserId', me.id);
  if (currentCursor) params.set('cursor', currentCursor);

  const {
    data,
    isLoading,
    isError,
  } = useQuery<TasksResponse>({
    queryKey: ['tasks', { status, departmentId, mine: mine && me?.id, cursor: currentCursor }],
    queryFn: () => api.get(`tasks?${params.toString()}`),
    // The "mine" filter depends on `me.id`; skip until that resolves.
    enabled: !mine || !!me,
  });

  const items = data?.items ?? [];
  const nextCursor = data?.nextCursor ?? null;

  // Reset pagination whenever a filter changes — page 1 of new results.
  const resetAnd = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    setCursorStack([]);
  };

  const deptName = (id: string) => departments?.find((d) => d.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('statusLabel')}</label>
          <Select
            value={status}
            onValueChange={(v) => resetAnd(setStatus, v as TaskStatus | typeof ALL)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {ALL_STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {t(`status.${st}` as 'status.draft')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('departmentLabel')}</label>
          <Select
            value={departmentId}
            onValueChange={(v) => resetAnd(setDepartmentId, v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allDepartments')}</SelectItem>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => resetAnd(setMine, e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          {t('mineOnly')}
        </label>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.title')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.priority')}</TableHead>
              <TableHead>{t('columns.department')}</TableHead>
              <TableHead>{t('columns.dueDate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-destructive py-8">
                  {t('loadError')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium">{task.title}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[task.status]}>
                    {t(`status.${task.status}` as 'status.draft')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {t(`priority.${task.priority}` as 'priority.low')}
                  </Badge>
                </TableCell>
                <TableCell>{deptName(task.departmentId)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t('pageHint', { count: items.length })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={cursorStack.length === 0}
            onClick={() => setCursorStack((s) => s.slice(0, -1))}
          >
            {t('prev')}
          </Button>
          <Button
            variant="outline"
            disabled={!nextCursor}
            onClick={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}
          >
            {t('next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
