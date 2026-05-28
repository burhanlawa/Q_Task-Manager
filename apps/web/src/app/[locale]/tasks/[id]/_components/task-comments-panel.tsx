'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FileUpload } from '@/components/files/file-upload';
import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api';
import { CommentEditor, type CommentEditorHandle } from './comment-editor';

// 15-min edit window, matching the API. The server is authoritative; this
// is for hiding the Edit affordance from the UI past the cutoff. We render
// the menu live so a comment that ages past 15 min while open
// auto-collapses on the next render.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

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
  const editorRef = useRef<CommentEditorHandle>(null);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bump on every editor change so the submit button enables/disables
  // without us mirroring the editor's HTML in React state.
  const [, setTick] = useState(0);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['task', taskId, 'comments'],
    queryFn: () => api.get(`tasks/${taskId}/comments`),
  });

  // Task — used to bias the mention dropdown to the task's department and
  // assignees per the spec's "department + watchers" framing.
  const { data: task } = useQuery<{
    departmentId: string;
    assignees: Array<{ userId: string }>;
  }>({
    queryKey: ['task', taskId],
    queryFn: () => api.get(`tasks/${taskId}`),
  });

  const { data: me } = useQuery<{ id: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  const create = useMutation({
    mutationFn: () => {
      const body = editorRef.current?.getHTML() ?? '';
      const mentioned_user_ids = editorRef.current?.getMentionIds() ?? [];
      return api.post(`tasks/${taskId}/comments`, {
        body,
        mentioned_user_ids,
        attachment_file_ids: attachmentIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
      editorRef.current?.clear();
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
            <CommentRow
              key={c.id}
              comment={c}
              myId={me?.id}
              taskId={taskId}
              departmentId={task?.departmentId}
              assigneeIds={task?.assignees?.map((a) => a.userId)}
              onDownload={(id) => download.mutate(id)}
            />
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">{t('composer.title')}</h3>
        <CommentEditor
          ref={editorRef}
          departmentId={task?.departmentId}
          assigneeIds={task?.assignees?.map((a) => a.userId)}
          placeholder={t('composer.placeholder')}
          onUpdate={() => setTick((n) => n + 1)}
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
            disabled={editorRef.current?.isEmpty() !== false || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t('composer.submitting') : t('composer.submit')}
          </Button>
        </div>
      </div>
    </section>
  );
}

// One comment with optional inline-edit + delete. Authoring + the 15-min
// window are computed live so a row that ages past the cutoff loses its
// Edit affordance on next render. Server is authoritative — UI is a
// courtesy.
function CommentRow({
  comment,
  myId,
  taskId,
  departmentId,
  assigneeIds,
  onDownload,
}: {
  comment: Comment;
  myId: string | undefined;
  taskId: string;
  departmentId: string | undefined;
  assigneeIds: string[] | undefined;
  onDownload: (fileId: string) => void;
}) {
  const t = useTranslations('tasks.comments');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<CommentEditorHandle>(null);

  // Tick every minute while menu is open so the "within window" boundary
  // re-evaluates without requiring user input.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!menuOpen && !editing) return;
    const i = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, [menuOpen, editing]);

  const isAuthor = !!myId && myId === comment.authorUserId;
  const ageMs = Date.now() - new Date(comment.createdAt).getTime();
  const withinWindow = ageMs <= EDIT_WINDOW_MS;
  const canEdit = isAuthor && withinWindow;
  const canDelete = isAuthor;

  const update = useMutation({
    mutationFn: () => {
      const body = editorRef.current?.getHTML() ?? '';
      const mentioned_user_ids = editorRef.current?.getMentionIds() ?? [];
      return api.patch(`comments/${comment.id}`, { body, mentioned_user_ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
      setEditing(false);
      setError(null);
    },
    onError: (err: ApiError) => {
      setError(err.message || t('errors.editFailed'));
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`comments/${comment.id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'comments'] }),
    onError: (err: ApiError) => setError(err.message || t('errors.deleteFailed')),
  });

  return (
    <li className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{nameOf(comment.author)}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(comment.createdAt).toLocaleString()}
            {comment.editedAt && ` · ${t('edited')}`}
          </span>
          {(canEdit || canDelete) && !editing && (
            <div className="relative">
              <button
                type="button"
                aria-label={t('actions.menu')}
                onClick={() => setMenuOpen((v) => !v)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div className="absolute end-0 z-10 mt-1 min-w-32 rounded-md border bg-popover text-popover-foreground shadow-md">
                  {canEdit && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                      className="block w-full px-3 py-2 text-start text-sm hover:bg-accent"
                    >
                      {t('actions.edit')}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setMenuOpen(false);
                        if (window.confirm(t('actions.confirmDelete'))) {
                          remove.mutate();
                        }
                      }}
                      className="block w-full px-3 py-2 text-start text-sm text-destructive hover:bg-accent"
                    >
                      {t('actions.delete')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <CommentEditor
            ref={editorRef}
            departmentId={departmentId}
            assigneeIds={assigneeIds}
            placeholder={t('composer.placeholder')}
          />
          {/* Seed the editor's initial content from the existing body. We do
              this via the ref because CommentEditor manages its own state. */}
          <SeedEditor editorRef={editorRef} body={comment.body} />
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              {t('actions.cancelEdit')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate()}
            >
              {update.isPending ? t('actions.saving') : t('actions.save')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Trusted HTML — produced by our own TipTap editor server-side */}
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: comment.body }}
          />
          {comment.attachments.length > 0 && (
            <div className="space-y-2 pt-1">
              {comment.attachments.map((a) =>
                isImage(a.content_type) ? (
                  <CommentImage key={a.id} fileId={a.id} alt={a.original_filename} />
                ) : (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onDownload(a.id)}
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
        </>
      )}
    </li>
  );
}

// Seeds the editor's initial content once on first mount. Subsequent prop
// changes are ignored so the user's in-progress edits aren't clobbered.
function SeedEditor({
  editorRef,
  body,
}: {
  editorRef: React.RefObject<CommentEditorHandle | null>;
  body: string;
}) {
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    // The editor may mount one tick after our ref runs. Retry briefly.
    const tryOnce = () => {
      const ed = editorRef.current;
      if (!ed) return false;
      ed.setHTML(body);
      seeded.current = true;
      return true;
    };
    if (tryOnce()) return;
    const i = setInterval(() => {
      if (tryOnce()) clearInterval(i);
    }, 30);
    return () => clearInterval(i);
  }, [body, editorRef]);
  return null;
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
