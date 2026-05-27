'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Me = {
  company: { id: string; name: string; logoFileId: string | null };
};
type DownloadResp = { download_url: string };

// Small client component for the header: shows the company logo when set,
// falls back to nothing (the adjacent text label keeps the brand visible).
// The signed URL is short-lived (5 min) so we re-fetch on page load.
export function CompanyLogo({ className }: { className?: string }) {
  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
    // Authenticated routes — Clerk may not be ready when this mounts.
    // Failures are silent; the header degrades to the text label.
    retry: false,
  });

  const { data: signed } = useQuery<DownloadResp>({
    queryKey: ['company-logo-url', me?.company.logoFileId],
    queryFn: () => api.get(`files/${me!.company.logoFileId}/download`),
    enabled: !!me?.company.logoFileId,
    retry: false,
  });

  if (!signed?.download_url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={signed.download_url}
      alt={me?.company.name ?? ''}
      className={className ?? 'h-7 w-7 rounded object-contain'}
    />
  );
}
