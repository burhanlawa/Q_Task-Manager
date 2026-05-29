'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

type Actor = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
} | null;

type Entry = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor: Actor;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  field_changed: string | null;
  metadata: unknown;
};

type PageResponse = {
  items: Entry[];
  nextCursor: string | null;
};

type DatePreset = 'all' | 'today' | '7d' | '30d' | '90d' | '12m';

type Filters = {
  actor_id: string;
  entity_type: string;
  entity_id: string;
  date_preset: DatePreset;
};

const EMPTY_FILTERS: Filters = {
  actor_id: '',
  entity_type: '',
  entity_id: '',
  date_preset: 'all',
};

export function ActivityLogViewer() {
  const t = useTranslations('activity');
  const locale = useLocale();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const query = useInfiniteQuery<PageResponse>({
    queryKey: ['activity-log', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.actor_id) qs.set('actor_id', filters.actor_id);
      if (filters.entity_type) qs.set('entity_type', filters.entity_type);
      if (filters.entity_id) qs.set('entity_id', filters.entity_id);
      if (filters.date_preset !== 'all') qs.set('date_preset', filters.date_preset);
      if (pageParam) qs.set('cursor', String(pageParam));
      const q = qs.toString();
      return api.get<PageResponse>(`activity-log${q ? `?${q}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // IntersectionObserver-backed sentinel for infinite scroll. When the
  // sentinel <div> enters the viewport AND there's another page available,
  // fetch the next batch.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <FilterPanel filters={filters} setFilters={setFilters} t={t} />

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <Row entry={entry} t={t} locale={locale} />
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinelRef} />
      {query.isFetchingNextPage && (
        <p className="py-2 text-center text-xs text-muted-foreground">{t('loadingMore')}</p>
      )}
      {!query.hasNextPage && items.length > 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">{t('endReached')}</p>
      )}
    </div>
  );
}

function FilterPanel({
  filters,
  setFilters,
  t,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="f-actor">{t('filters.actor')}</Label>
        <Input
          id="f-actor"
          value={filters.actor_id}
          onChange={(e) => setFilters({ ...filters, actor_id: e.target.value })}
          placeholder={t('filters.actorPlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-entity-type">{t('filters.entityType')}</Label>
        <Input
          id="f-entity-type"
          value={filters.entity_type}
          onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
          placeholder={t('filters.entityTypePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-entity-id">{t('filters.entityId')}</Label>
        <Input
          id="f-entity-id"
          value={filters.entity_id}
          onChange={(e) => setFilters({ ...filters, entity_id: e.target.value })}
          placeholder={t('filters.entityIdPlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-when">{t('filters.datePreset')}</Label>
        <Select
          value={filters.date_preset}
          onValueChange={(v) => setFilters({ ...filters, date_preset: v as DatePreset })}
        >
          <SelectTrigger id="f-when">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.presets.all')}</SelectItem>
            <SelectItem value="today">{t('filters.presets.today')}</SelectItem>
            <SelectItem value="7d">{t('filters.presets.7d')}</SelectItem>
            <SelectItem value="30d">{t('filters.presets.30d')}</SelectItem>
            <SelectItem value="90d">{t('filters.presets.90d')}</SelectItem>
            <SelectItem value="12m">{t('filters.presets.12m')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS)}
        >
          {t('filters.clear')}
        </Button>
      </div>
    </div>
  );
}

// Renders one row as a human-readable line. Maps action_type to the right
// i18n key; falls back to a generic "{actor} performed: {actionType}" so
// unknown event types stay legible. Metadata is rendered as a small
// JSON snippet under the headline when present.
function Row({
  entry,
  t,
  locale,
}: {
  entry: Entry;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const actor = displayActor(entry.actor, t);
  const headline = renderHeadline(entry, actor, t);
  const meta =
    entry.metadata && Object.keys(entry.metadata as object).length > 0
      ? entry.metadata
      : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm">{headline}</p>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(entry.created_at, locale)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        <span>{entry.action_type}</span>
        {entry.target_type && (
          <>
            <span> · </span>
            <span>
              {entry.target_type}
              {entry.target_id ? ` ${entry.target_id.slice(0, 8)}…` : ''}
            </span>
          </>
        )}
        {entry.field_changed && (
          <>
            <span> · </span>
            <span>{entry.field_changed}</span>
          </>
        )}
      </p>
      {meta && (
        <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
    </div>
  );
}

function displayActor(actor: Actor, t: ReturnType<typeof useTranslations>): string {
  if (!actor) return t('systemActor');
  return (
    actor.displayName ??
    [actor.firstName, actor.lastName].filter(Boolean).join(' ') ??
    actor.email ??
    t('anUnknownUser')
  );
}

function renderHeadline(
  entry: Entry,
  actor: string,
  t: ReturnType<typeof useTranslations>,
): string {
  // next-intl throws on missing keys by default. We catch and fall back.
  try {
    return t(`actions.${entry.action_type}`, { actor });
  } catch {
    return t('actions.fallback', { actor, actionType: entry.action_type });
  }
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
