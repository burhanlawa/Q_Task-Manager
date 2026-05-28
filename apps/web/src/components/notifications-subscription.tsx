'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import PusherClient, { type Channel } from 'pusher-js';
import { api } from '@/lib/api';

type Me = { id: string };

// Sprint 14.6 — connect to Pusher, subscribe to the caller's private channel,
// and bounce incoming 'notification' events into the React Query cache so
// any view of `['notifications']` (the bell, the dropdown) refreshes live.
//
// Mounted once in the locale layout. Renders nothing — pure side-effect.
//
// Pusher auth flow: pusher-js POSTs to /api/proxy/pusher/auth, which forwards
// to NestJS /pusher/auth with the Clerk JWT. The backend verifies the channel
// matches `private-user-<callerId>` and signs the response.
export function NotificationsSubscription() {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const clientRef = useRef<PusherClient | null>(null);
  const channelRef = useRef<Channel | null>(null);

  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (!key || !cluster || !me?.id) return;

    // The /api/proxy route attaches the Clerk JWT server-side, so the
    // browser never sees the bearer token.
    const client = new PusherClient(key, {
      cluster,
      forceTLS: true,
      // pusher-js's default auth sender posts the body as
      // application/x-www-form-urlencoded which NestJS' JSON pipe rejects with
      // 400. Use channelAuthorization.customHandler so we POST JSON ourselves
      // and forward Pusher's response unchanged.
      channelAuthorization: {
        transport: 'ajax',
        endpoint: '/api/proxy/pusher/auth',
        customHandler: ({ socketId, channelName }, callback) => {
          fetch('/api/proxy/pusher/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ socket_id: socketId, channel_name: channelName }),
          })
            .then(async (r) => {
              if (!r.ok) throw new Error(`pusher auth failed: ${r.status}`);
              return r.json();
            })
            .then((data) => callback(null, data))
            .catch((err) => callback(err, null));
        },
      },
    });
    clientRef.current = client;

    const channelName = `private-user-${me.id}`;
    const channel = client.subscribe(channelName);
    channelRef.current = channel;

    const onNotification = () => {
      // Don't merge the payload optimistically — re-fetch via the existing
      // 14.5 list query so unreadCount, ordering, and expires_at filtering
      // stay authoritative on the server.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    channel.bind('notification', onNotification);

    return () => {
      channel.unbind('notification', onNotification);
      client.unsubscribe(channelName);
      client.disconnect();
      clientRef.current = null;
      channelRef.current = null;
    };
  }, [me?.id, queryClient]);

  return null;
}
