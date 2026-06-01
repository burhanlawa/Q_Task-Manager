'use client';

import { QueryClient, QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

// We persist a slice of the query cache to localStorage so that data the
// layout chrome depends on (the `me` / permissions queries the sidebar gates
// on) survives a full page reload. Without this, every reload re-fetches
// over the network and the sidebar renders empty until both round-trips land
// — a visible "blank then fills in" flash. Restoring from localStorage lets
// the sidebar paint immediately with last-known data while it revalidates in
// the background.
//
// This is a deliberately tiny, dependency-free version of what
// @tanstack/react-query-persist-client does. We only persist the `me` family
// of queries (small, user-scoped, safe to show stale for a moment) rather
// than the whole cache.

const STORAGE_KEY = 'qtm.rq-cache.v1';
// How long a persisted entry is considered worth restoring. Past this we drop
// it on load so a user who's been away doesn't see very stale chrome.
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// Only persist these query keys. Matched against the first element of the
// query key array. Keep this list narrow — it's layout chrome, not page data.
const PERSISTED_KEY_ROOTS = new Set(['me']);

type PersistedShape = {
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
};

function shouldPersist(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && PERSISTED_KEY_ROOTS.has(queryKey[0]);
}

function restore(client: QueryClient): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    hydrate(client, parsed.state);
  } catch {
    // Corrupt or schema-changed cache — discard it rather than crash.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

function persist(client: QueryClient): void {
  if (typeof window === 'undefined') return;
  try {
    const state = dehydrate(client, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && shouldPersist(query.queryKey),
    });
    const payload: PersistedShape = { savedAt: Date.now(), state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or serialization error — non-fatal; we just skip persisting.
  }
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const c = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          // Keep cached entries around long enough to be restored on reload.
          gcTime: MAX_AGE_MS,
          refetchOnWindowFocus: false,
          retry: 1,
        },
        mutations: { retry: 0 },
      },
    });
    // Restore synchronously during the initial render so the first paint of
    // the sidebar already has the persisted `me` data.
    restore(c);
    return c;
  });

  useEffect(() => {
    // Persist on every cache change (debounced to the next microtask burst via
    // a short timer) and once more on unload, so a reload always has fresh
    // bytes to restore from.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => persist(client), 250);
    };
    const unsubscribe = client.getQueryCache().subscribe(schedule);
    const onHide = () => persist(client);
    window.addEventListener('pagehide', onHide);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('pagehide', onHide);
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
