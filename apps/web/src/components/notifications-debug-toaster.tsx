'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Notification = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  link: string | null;
};
type ListResponse = {
  items: Notification[];
  unreadCount: number;
};

// Dev-only smoke check for Sprint 14.6. While the bell UI isn't built yet,
// this watches the ['notifications'] query (which is invalidated by the
// Pusher subscription) and toasts any row newer than the previous fetch.
// That gives the human a visible "<1s without refresh" signal.
//
// Safe to leave mounted in production too — at worst it just toasts the
// same thing the bell will, but the bell when it ships will replace it.
export function NotificationsDebugToaster() {
  const { isLoaded, isSignedIn } = useAuth();
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const { data } = useQuery<ListResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get('notifications'),
    enabled: isLoaded && !!isSignedIn,
    // The hook fires automatically (invalidated by Pusher), so we don't need
    // a polling interval.
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.items.map((i) => i.id));
    if (!initialized.current) {
      // First payload: prime the set, don't toast anything (these are
      // historical, not "just arrived").
      seen.current = ids;
      initialized.current = true;
      return;
    }
    for (const item of data.items) {
      if (!seen.current.has(item.id)) {
        toast(item.title ?? item.type, {
          description: item.body ?? undefined,
          action: item.link ? { label: 'Open', onClick: () => (window.location.href = item.link!) } : undefined,
        });
      }
    }
    seen.current = ids;
  }, [data]);

  return null;
}
