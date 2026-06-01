'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Notification = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

type ListResponse = {
  items: Notification[];
  unreadCount: number;
};

// Bell + dropdown in the site header (Sprint 14.7).
//   - Badge shows unreadCount; hidden when zero.
//   - Reads ['notifications'] — same key that the Pusher subscription invalidates
//     on real-time events, so the badge updates live.
//   - Newest 10 in the dropdown.
//   - Click a row → mark-read (optimistic-ish: re-fetch on success) + navigate to
//     its action_url. Rows without a link still mark-read but don't navigate.
//   - "Mark all as read" button at the bottom when anything is unread.
export function NotificationBell() {
  const { isLoaded, isSignedIn } = useAuth();
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useQuery<ListResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get('notifications'),
    enabled: isLoaded && !!isSignedIn,
    refetchOnWindowFocus: false,
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post('notifications/mark-read', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post('notifications/mark-all-read', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // While Clerk auth is still loading, reserve the bell's slot with an
  // invisible placeholder so the header doesn't reflow when the bell
  // pops in. Once we know the user is signed-out, collapse to null.
  if (!isLoaded) return <div className="h-9 w-9" aria-hidden />;
  if (!isSignedIn) return null;

  const unread = data?.unreadCount ?? 0;
  const items = (data?.items ?? []).slice(0, 10);

  function onItemClick(n: Notification) {
    if (!n.readAt) markRead.mutate([n.id]);
    if (n.link) {
      // Action URLs are server-relative paths like '/tasks/<id>'. Strip the
      // leading slash because next-intl's typed router prepends one based on
      // locale.
      const path = n.link.startsWith('/') ? n.link : `/${n.link}`;
      // next-intl Link/router types are strict; cast keeps dynamic notification
      // links flexible without enumerating every shape.
      router.push(path as never);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('ariaLabel')}
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              aria-label={t('unreadBadge', { count: unread })}
              className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t('title')}</span>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {t('markAllRead')}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={cn(
                    'block w-full px-3 py-2 text-start text-sm hover:bg-accent',
                    !n.readAt && 'bg-accent/40',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{n.title ?? t('untitled')}</div>
                      {n.body && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatRelative(new Date(n.createdAt), locale)}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Lightweight relative-time formatter. Uses Intl.RelativeTimeFormat so we get
// "5 min ago" → "قبل 5 دقائق" → "٥ خولەک پێش" without an extra dep.
function formatRelative(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSec = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
