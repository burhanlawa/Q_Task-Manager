'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/files/file-upload';
import { api } from '@/lib/api';

type Me = {
  company: { id: string; name: string; logoFileId: string | null };
};

type DownloadResp = { download_url: string };

const LOGO_MIMES = { 'image/png': [], 'image/jpeg': [] };

export function CompanyLogoSection() {
  const t = useTranslations('settings.company.logo');
  const queryClient = useQueryClient();

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });

  // Fetch a signed URL for the current logo so we can preview it. Cached
  // for the duration of the page since signed URLs are 5-min valid anyway;
  // a hard refresh re-fetches.
  const { data: signed } = useQuery<DownloadResp>({
    queryKey: ['company-logo-url', me?.company.logoFileId],
    queryFn: () => api.get(`files/${me!.company.logoFileId}/download`),
    enabled: !!me?.company.logoFileId,
  });

  if (!me) return null;

  return (
    <section className="rounded-md border p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
      </div>

      {me.company.logoFileId && signed?.download_url ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signed.download_url}
            alt={t('currentAlt', { name: me.company.name })}
            className="h-16 w-16 rounded border bg-muted object-contain p-1"
          />
          <p className="text-xs text-muted-foreground">{t('currentHint')}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      <FileUpload
        purpose="company_logo"
        attachedToType="company"
        accept={LOGO_MIMES}
        onUploaded={() => {
          // Re-fetch `me` so the new logoFileId surfaces, which in turn
          // re-fetches the signed URL.
          queryClient.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    </section>
  );
}
