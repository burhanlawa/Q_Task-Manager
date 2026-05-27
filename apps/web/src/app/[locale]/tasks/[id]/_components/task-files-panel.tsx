'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/files/file-upload';
import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api';

type FileRow = {
  id: string;
  purpose: 'task_attachment' | 'task_submission' | 'avatar' | 'company_logo';
  originalFilename: string;
  contentType: string;
  sizeBytes: string;
  uploaderUserId: string;
  versionNumber: number;
  previousVersionId: string | null;
  createdAt: string;
};

type FilesResponse = { items: FileRow[] };

type Task = {
  id: string;
  status: string;
  createdByUserId: string;
  assignedToUserId: string | null;
  assignees?: Array<{ userId: string }>;
};

type Me = { id: string };
type MyPerms = { permissions: string[] };

const REFERENCE_MIMES = {
  'application/pdf': [],
  'application/msword': [],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [],
  'application/vnd.ms-excel': [],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
  'image/jpeg': [],
  'image/png': [],
};

// Same set; the backend gates the mime allowlist per purpose already, so we
// reuse the broad list for both upload widgets.
const DELIVERABLE_MIMES = REFERENCE_MIMES;

function isAssignee(task: Task, userId: string): boolean {
  if (task.assignedToUserId === userId) return true;
  return (task.assignees ?? []).some((a) => a.userId === userId);
}

function hasPerm(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}

export function TaskFilesPanel({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.files');
  const queryClient = useQueryClient();

  const { data: filesData, isLoading } = useQuery<FilesResponse>({
    queryKey: ['task', taskId, 'files'],
    queryFn: () => api.get(`files?owner_type=task&owner_id=${taskId}`),
  });

  const { data: task } = useQuery<Task>({
    queryKey: ['task', taskId],
    queryFn: () => api.get(`tasks/${taskId}`),
  });

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  const { data: perms } = useQuery<MyPerms>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
  });

  // Mutation: ask the API for a signed download URL then redirect the
  // browser to it. The mutation also forces a fresh request each click so
  // the URL is never stale.
  const download = useMutation({
    mutationFn: (fileId: string) =>
      api.get<{ download_url: string }>(`files/${fileId}/download`),
    onSuccess: (resp) => {
      // Trigger the actual file fetch in a new tab. R2 will serve it inline
      // or as a download depending on content-disposition (we don't set
      // any so the browser decides by mime — images render inline, PDFs in
      // PDF viewer, office docs prompt save).
      window.open(resp.download_url, '_blank');
    },
  });

  const files = filesData?.items ?? [];
  const references = files.filter((f) => f.purpose === 'task_attachment');
  const deliverables = files.filter((f) => f.purpose === 'task_submission');

  // The latest deliverable head — anything not pointed at by another row's
  // previous_version_id. Walking forward from the highest version_number is
  // the cheapest approach since the API returns DESC-by-createdAt.
  const deliverableHeads = deliverables.filter(
    (f) => !deliverables.some((other) => other.previousVersionId === f.id),
  );

  if (isLoading || !task || !me || !perms) {
    return null;
  }

  const myId = me.id;
  const myPerms = perms.permissions;
  const isCreator = task.createdByUserId === myId;
  const isAssign = isAssignee(task, myId);

  // Reference (assigner-side): creator OR has task.assign. Mutable only
  // while the task is in editable states (draft/assigned) — once work has
  // begun, references are part of the historical record.
  const canUploadReference =
    (isCreator || hasPerm(myPerms, 'task.assign')) &&
    (task.status === 'draft' || task.status === 'assigned');

  // Deliverable (assignee-side): assignees during active work or revision.
  const canUploadDeliverable =
    isAssign && (task.status === 'in_progress' || task.status === 'submitted');

  // Each new deliverable chains onto the latest existing one (there should
  // be at most one chain head; if multiple, pick the most recent).
  const latestDeliverable = deliverableHeads.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];

  return (
    <div className="space-y-6">
      <section className="rounded-md border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t('reference.title')}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t('count', { n: references.length })}
          </span>
        </div>

        {references.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reference.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {references.map((f) => (
              <FileRowView key={f.id} file={f} onDownload={(id) => download.mutate(id)} />
            ))}
          </ul>
        )}

        {canUploadReference && (
          <FileUpload
            purpose="task_attachment"
            attachedToType="task"
            attachedToId={taskId}
            accept={REFERENCE_MIMES}
            multiple
            onUploaded={() =>
              queryClient.invalidateQueries({ queryKey: ['task', taskId, 'files'] })
            }
          />
        )}
      </section>

      <section className="rounded-md border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t('deliverables.title')}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t('count', { n: deliverables.length })}
          </span>
        </div>

        {deliverables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('deliverables.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {deliverables.map((f) => (
              <FileRowView
                key={f.id}
                file={f}
                onDownload={(id) => download.mutate(id)}
                showVersion
              />
            ))}
          </ul>
        )}

        {canUploadDeliverable && (
          <FileUpload
            purpose="task_submission"
            attachedToType="task"
            attachedToId={taskId}
            accept={DELIVERABLE_MIMES}
            previousVersionId={latestDeliverable?.id}
            onUploaded={() =>
              queryClient.invalidateQueries({ queryKey: ['task', taskId, 'files'] })
            }
          />
        )}
      </section>

      {download.isError && (
        <p className="text-sm text-destructive">
          {(download.error as ApiError)?.message ?? t('errors.downloadFailed')}
        </p>
      )}
    </div>
  );
}

function FileRowView({
  file,
  onDownload,
  showVersion = false,
}: {
  file: FileRow;
  onDownload: (id: string) => void;
  showVersion?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-medium">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.originalFilename}</span>
          {showVersion && (
            <span className="ms-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              v{file.versionNumber}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(Number(file.sizeBytes))} · {new Date(file.createdAt).toLocaleString()}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onDownload(file.id)}>
        <Download className="h-4 w-4" />
      </Button>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
