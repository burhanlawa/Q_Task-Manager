'use client';

import { UploadCloud, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { api, ApiError } from '@/lib/api';

// One row per attempted upload. Lives in component state — once the parent
// has the file_id it can hand off to wherever it wants to store the link.
type UploadItem = {
  // Stable id for React keys. Not the server's file_id.
  localId: string;
  file: File;
  // 0..100. Driven by XHR progress events.
  progress: number;
  status: 'queued' | 'requesting' | 'uploading' | 'completing' | 'done' | 'error';
  errorMessage?: string;
  // Set once /files/upload-intent returns.
  fileId?: string;
  // The XHR running the PUT — held so the user can cancel.
  xhr?: XMLHttpRequest;
};

type UploadIntentResponse = {
  file_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
};

export type FileUploadProps = {
  // Which purpose to send in the upload-intent body.
  purpose: 'task_attachment' | 'task_submission' | 'avatar' | 'company_logo';
  attachedToType: 'task' | 'user' | 'company';
  attachedToId?: string;
  // Comma-separated MIME pattern for the dropzone (e.g. 'image/png,image/jpeg').
  // The backend re-enforces a stricter allowlist per purpose; this is just UX.
  accept?: Record<string, string[]>;
  maxSizeBytes?: number;
  multiple?: boolean;
  // Fires once per file when the server-side complete step succeeds.
  // Parent decides what to do with the id (attach to a task, set avatar, etc.).
  onUploaded?: (fileId: string, file: File) => void;
  // Tag chains require the new upload to point at the prior version. The
  // parent supplies the prior id and we forward it on upload-intent.
  previousVersionId?: string;
  // Optional className for the dropzone container.
  className?: string;
};

export function FileUpload({
  purpose,
  attachedToType,
  attachedToId,
  accept,
  maxSizeBytes = 50 * 1024 * 1024,
  multiple = false,
  onUploaded,
  previousVersionId,
  className,
}: FileUploadProps) {
  const t = useTranslations('files.upload');
  const [items, setItems] = useState<UploadItem[]>([]);

  const updateItem = useCallback((localId: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }, []);

  const startUpload = useCallback(
    async (item: UploadItem) => {
      const { localId, file } = item;
      updateItem(localId, { status: 'requesting', progress: 0 });

      // 1. POST /files/upload-intent
      let intent: UploadIntentResponse;
      try {
        intent = await api.post<UploadIntentResponse>('files/upload-intent', {
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          purpose,
          attached_to_type: attachedToType,
          attached_to_id: attachedToId,
          ...(previousVersionId ? { previous_version_id: previousVersionId } : {}),
        });
      } catch (e) {
        const err = e as ApiError;
        updateItem(localId, {
          status: 'error',
          errorMessage: pickIntentErrorMessage(err, t),
        });
        return;
      }
      updateItem(localId, { fileId: intent.file_id, status: 'uploading' });

      // 2. PUT to R2 with progress (XHR — fetch can't stream progress).
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', intent.upload_url, true);
        for (const [k, v] of Object.entries(intent.upload_headers)) {
          xhr.setRequestHeader(k, v);
        }
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            updateItem(localId, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            updateItem(localId, { progress: 100 });
            resolve();
          } else {
            updateItem(localId, { status: 'error', errorMessage: t('errors.uploadFailed') });
            resolve();
          }
        });
        xhr.addEventListener('error', () => {
          updateItem(localId, { status: 'error', errorMessage: t('errors.network') });
          resolve();
        });
        xhr.addEventListener('abort', () => {
          updateItem(localId, { status: 'error', errorMessage: t('errors.cancelled') });
          resolve();
        });
        updateItem(localId, { xhr });
        xhr.send(file);
      });

      // 3. Bail if the PUT failed — error message already set.
      const current = await new Promise<UploadItem | undefined>((resolve) =>
        setItems((prev) => {
          resolve(prev.find((it) => it.localId === localId));
          return prev;
        }),
      );
      if (!current || current.status === 'error') return;

      // 4. POST /files/{id}/complete
      updateItem(localId, { status: 'completing' });
      try {
        await api.post(`files/${intent.file_id}/complete`, {});
      } catch (e) {
        const err = e as ApiError;
        updateItem(localId, { status: 'error', errorMessage: err.message || t('errors.completeFailed') });
        return;
      }

      updateItem(localId, { status: 'done', xhr: undefined });
      onUploaded?.(intent.file_id, file);
    },
    [attachedToId, attachedToType, onUploaded, previousVersionId, purpose, t, updateItem],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      // Rejected files (size/type) — render their local error so the user
      // sees why they didn't upload. No server roundtrip needed.
      const rejectedItems: UploadItem[] = rejected.map((r) => ({
        localId: crypto.randomUUID(),
        file: r.file,
        progress: 0,
        status: 'error',
        errorMessage:
          r.errors[0]?.code === 'file-too-large'
            ? t('errors.tooLarge', { maxMb: Math.round(maxSizeBytes / 1024 / 1024) })
            : r.errors[0]?.code === 'file-invalid-type'
              ? t('errors.invalidType')
              : t('errors.rejected'),
      }));
      const acceptedItems: UploadItem[] = accepted.map((f) => ({
        localId: crypto.randomUUID(),
        file: f,
        progress: 0,
        status: 'queued',
      }));
      const all = [...rejectedItems, ...acceptedItems];
      setItems((prev) => [...prev, ...all]);
      // Kick off the accepted ones in parallel.
      for (const it of acceptedItems) startUpload(it);
    },
    [maxSizeBytes, startUpload, t],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize: maxSizeBytes,
    multiple,
  });

  function cancel(item: UploadItem) {
    if (item.xhr) item.xhr.abort();
    setItems((prev) => prev.filter((it) => it.localId !== item.localId));
  }

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={`rounded-md border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <UploadCloud className="h-8 w-8" />
          <p>{isDragActive ? t('dropToUpload') : t('dragOrBrowse')}</p>
          <p className="text-xs">
            {t('limitHint', { maxMb: Math.round(maxSizeBytes / 1024 / 1024) })}
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.localId}
              className="rounded-md border p-3 space-y-1.5 text-sm bg-background"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(item.file.size)} · {statusLabel(item.status, t)}
                  </p>
                </div>
                {item.status !== 'done' && (
                  <button
                    type="button"
                    aria-label={t('cancel')}
                    onClick={() => cancel(item)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {(item.status === 'uploading' || item.status === 'completing') && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}

              {item.status === 'error' && (
                <p className="text-xs text-destructive">{item.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Tx = (key: string, values?: Record<string, string | number | Date>) => string;

function statusLabel(status: UploadItem['status'], t: Tx): string {
  switch (status) {
    case 'queued':
      return t('status.queued');
    case 'requesting':
      return t('status.requesting');
    case 'uploading':
      return t('status.uploading');
    case 'completing':
      return t('status.completing');
    case 'done':
      return t('status.done');
    case 'error':
      return t('status.error');
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Map server error shapes to a translated message. The 422 storage-limit
// error includes structured fields; everything else falls back to .message.
function pickIntentErrorMessage(err: ApiError, t: Tx): string {
  const body = err.body as { plan?: string; limit_bytes?: string; used_bytes?: string } | null;
  if (err.status === 422 && body?.plan && body?.limit_bytes) {
    return t('errors.storageLimit', {
      plan: body.plan,
      limitMb: Math.round(Number(body.limit_bytes) / 1024 / 1024),
    });
  }
  if (err.status === 400) return err.message || t('errors.rejected');
  if (err.status === 403) return t('errors.forbidden');
  if (err.status === 404) return t('errors.notFound');
  return err.message || t('errors.intentFailed');
}
