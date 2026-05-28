'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FileUpload } from '@/components/files/file-upload';
import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api';

type Attachment = {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
};

type Author = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

type Comment = {
  id: string;
  body: string;
  authorUserId: string;
  createdAt: string;
  editedAt: string | null;
  mentioned_user_ids: string[];
  attachments: Attachment[];
  author: Author | null;
};

type ListResponse = { items: Comment[] };

const ATTACHMENT_MIMES = {
  'application/pdf': [],
  'application/msword': [],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [],
  'application/vnd.ms-excel': [],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
  'image/jpeg': [],
  'image/png': [],
};

function nameOf(a: Author | null): string {
  if (!a) return '—';
  return a.displayName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() ?? a.email;
}

function isImage(ct: string): boolean {
  return ct.startsWith('image/');
}

export function TaskCommentsPanel({ taskId }: { taskId: string }) {
  const t = useTranslations('tasks.comments');
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['task', taskId, 'comments'],
    queryFn: () => api.get(`tasks/${taskId}/comments`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`tasks/${taskId}/comments`, {
        body,
        attachment_file_ids: attachmentIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
      setBody('');
      setAttachmentIds([]);
      setError(null);
    },
    onError: (err: ApiError) => {
      setError(err.message || t('errors.createFailed'));
    },
  });

  const download = useMutation({
    mutationFn: (fileId: string) =>
      api.get<{ download_url: string }>(`files/${fileId}/download`),
    onSuccess: (r) => window.open(r.download_url, '_blank'),
  });

  if (isLoading || !data) return null;

  return (
    <section className="rounded-md border p-5 space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {t('title', { count: data.items.length })}
      </h2>

      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {data.items.map((c) => (
            <li key={c.id} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{nameOf(c.author)}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.editedAt && ` · ${t('edited')}`}
                </span>
              </div>
              {/* Trusted HTML — produced by our own TipTap editor server-side */}
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: c.body }}
              />
              {c.attachments.length > 0 && (
                <div className="space-y-2 pt-1">
                  {c.attachments.map((a) =>
                    isImage(a.content_type) ? (
                      <CommentImage
                        key={a.id}
                        fileId={a.id}
                        alt={a.original_filename}
                      />
                    ) : (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => download.mutate(a.id)}
                        className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span>{a.original_filename}</span>
                        <Download className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ),
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">{t('composer.title')}</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('composer.placeholder')}
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <FileUpload
          purpose="comment_attachment"
          attachedToType="comment"
          accept={ATTACHMENT_MIMES}
          multiple
          onUploaded={(fileId) => setAttachmentIds((prev) => [...prev, fileId])}
        />
        {attachmentIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('composer.attachmentsQueued', { n: attachmentIds.length })}
          </p>
        )}
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            disabled={!body.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t('composer.submitting') : t('composer.submit')}
          </Button>
        </div>
      </div>
    </section>
  );
}

// Lazily fetches a signed download URL for the image and renders it inline.
// We don't proxy through our API — the browser fetches R2 directly, same
// pattern as the company logo + task attachments.
function CommentImage({ fileId, alt }: { fileId: string; alt: string }) {
  const { data } = useQuery<{ download_url: string }>({
    queryKey: ['file-url', fileId],
    queryFn: () => api.get(`files/${fileId}/download`),
  });
  if (!data) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={data.download_url}
      alt={alt}
      className="max-h-80 max-w-full rounded border object-contain"
    />
  );
}
