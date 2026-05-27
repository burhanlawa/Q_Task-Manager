'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/files/file-upload';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type FilePurpose = 'avatar' | 'cv' | 'id_card' | 'certificate';

type FileRow = {
  id: string;
  purpose: FilePurpose | 'task_attachment' | 'task_submission' | 'company_logo';
  originalFilename: string;
  contentType: string;
  sizeBytes: string;
  versionNumber: number;
  previousVersionId: string | null;
  createdAt: string;
};

type FilesResponse = { items: FileRow[] };

type Me = { id: string };

// MIME allowlists must match what the API enforces. We keep them in sync here
// so the dropzone rejects upfront with a clean message instead of a server
// 400 round-trip.
const IMG_MIMES = { 'image/png': [], 'image/jpeg': [] };
const DOC_MIMES = {
  'application/pdf': [],
  'application/msword': [],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [],
};
const CERT_MIMES = { ...IMG_MIMES, ...DOC_MIMES };

export function ProfileFilesSection() {
  const t = useTranslations('me.profile.files');

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  if (!me) return null;

  return (
    <div className="space-y-6">
      <SectionHeader title={t('sectionTitle')} body={t('sectionBody')} />

      <PurposeBlock
        userId={me.id}
        purpose="avatar"
        accept={IMG_MIMES}
        title={t('avatar.title')}
        body={t('avatar.body')}
        emptyText={t('avatar.empty')}
        currentOnly
      />

      <PurposeBlock
        userId={me.id}
        purpose="cv"
        accept={DOC_MIMES}
        title={t('cv.title')}
        body={t('cv.body')}
        emptyText={t('cv.empty')}
        currentOnly
      />

      <PurposeBlock
        userId={me.id}
        purpose="id_card"
        accept={IMG_MIMES}
        title={t('idCard.title')}
        body={t('idCard.body')}
        emptyText={t('idCard.empty')}
        currentOnly
      />

      <PurposeBlock
        userId={me.id}
        purpose="certificate"
        accept={CERT_MIMES}
        title={t('certificate.title')}
        body={t('certificate.body')}
        emptyText={t('certificate.empty')}
      />
    </div>
  );
}

// One section per purpose. `currentOnly` flag: avatar/CV/ID card show only
// the "current" file (the chain head — no other row points at it) plus the
// upload widget that versions onto it. certificate shows the full list.
function PurposeBlock({
  userId,
  purpose,
  accept,
  title,
  body,
  emptyText,
  currentOnly = false,
}: {
  userId: string;
  purpose: FilePurpose;
  accept: Record<string, string[]>;
  title: string;
  body: string;
  emptyText: string;
  currentOnly?: boolean;
}) {
  const t = useTranslations('me.profile.files');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FilesResponse>({
    queryKey: ['user', userId, 'files', purpose],
    queryFn: () =>
      api.get(`files?owner_type=user&owner_id=${userId}`),
  });

  const ofPurpose = (data?.items ?? []).filter((f) => f.purpose === purpose);
  // Heads = rows that no other row chains from. For currentOnly purposes,
  // the head is the "current" file; everything else is the prior history.
  const heads = ofPurpose.filter(
    (f) => !ofPurpose.some((other) => other.previousVersionId === f.id),
  );
  const current = heads
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const visibleFiles = currentOnly && current ? [current] : ofPurpose;

  const download = useMutation({
    mutationFn: (fileId: string) =>
      api.get<{ download_url: string }>(`files/${fileId}/download`),
    onSuccess: (resp) => window.open(resp.download_url, '_blank'),
  });

  return (
    <section className="rounded-md border p-5 space-y-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>

      {isLoading ? null : visibleFiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {visibleFiles.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.originalFilename}</span>
                  {!currentOnly && (
                    <span className="ms-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                      v{f.versionNumber}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(Number(f.sizeBytes))} ·{' '}
                  {new Date(f.createdAt).toLocaleString()}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => download.mutate(f.id)}>
                <Download className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FileUpload
        purpose={purpose}
        attachedToType="user"
        attachedToId={userId}
        accept={accept}
        // currentOnly purposes: each upload replaces the current via the
        // version chain. certificate: each upload stands alone (v1 each).
        previousVersionId={currentOnly ? current?.id : undefined}
        onUploaded={() =>
          queryClient.invalidateQueries({
            queryKey: ['user', userId, 'files', purpose],
          })
        }
      />

      {current && currentOnly && (
        <p className="text-xs text-muted-foreground">
          {t('replaceHint', { version: current.versionNumber })}
        </p>
      )}
    </section>
  );
}

function SectionHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1 border-t pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
