'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';

type Tag = {
  id: string;
  name: string;
  color: string | null;
  categoryId: string;
};

type Category = {
  id: string;
  name: string;
};

type Props = {
  selected: Tag[];
  onChange: (next: Tag[]) => void;
  // When true, hide the "Create new" affordance even if the typed text
  // doesn't match an existing tag. Use for Employee role.
  canCreate: boolean;
};

export function TagPicker({ selected, onChange, canCreate }: Props) {
  const t = useTranslations('tasks.tagPicker');
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creatingCategoryId, setCreatingCategoryId] = useState<string>('');
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside the picker's container. Avoids blur-based logic
  // which interferes with sibling Radix portals (Selects) on the same form.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const c = containerRef.current;
      if (c && !c.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const { data: results = [] } = useQuery<Tag[]>({
    queryKey: ['tags', { q: query }],
    queryFn: () => api.get(`tags${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    // The query is cheap (small per-tenant tag list) — refetch on every keystroke.
    placeholderData: (prev) => prev,
  });

  // Categories are needed for the "Create new tag" flow — every tag must
  // belong to one. Fetched once; cached for the session.
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['tag-categories'],
    queryFn: () => api.get('tag-categories'),
    // Endpoint doesn't exist yet — surface 404s as empty so the picker still
    // works for selecting existing tags. (When 10.x adds the categories
    // endpoint this will start populating; until then, "Create new" stays
    // disabled with a hint.)
    retry: false,
  });

  // De-dupe results vs. already-selected, then sort: exact-name match first.
  const suggestions = useMemo(() => {
    const selectedIds = new Set(selected.map((t) => t.id));
    return results.filter((r) => !selectedIds.has(r.id));
  }, [results, selected]);

  const trimmed = query.trim();
  const exactMatch = suggestions.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  const showCreateOption =
    canCreate && trimmed.length > 0 && !exactMatch && categories.length > 0;

  const createTag = useMutation({
    mutationFn: (body: { name: string; categoryId: string }) => api.post<Tag>('tags', body),
    onSuccess: (tag) => {
      onChange([...selected, tag]);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setQuery('');
      setCreatingCategoryId('');
      setCreateError(null);
    },
    onError: (err: ApiError) => {
      setCreateError(err.message || t('errors.createFailed'));
    },
  });

  function add(tag: Tag) {
    onChange([...selected, tag]);
    setQuery('');
    inputRef.current?.focus();
  }
  function remove(id: string) {
    onChange(selected.filter((t) => t.id !== id));
  }

  // When the popup opens and a "Create new" row is shown, default the
  // category selector to the first category for one less click.
  useEffect(() => {
    if (showCreateOption && !creatingCategoryId && categories.length > 0) {
      setCreatingCategoryId(categories[0].id);
    }
  }, [showCreateOption, creatingCategoryId, categories]);

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="gap-1 pe-1"
              style={tag.color ? { borderColor: tag.color } : undefined}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => remove(tag.id)}
                aria-label={t('remove')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div ref={containerRef} className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={t('searchPlaceholder')}
          maxLength={80}
        />

        {open && (suggestions.length > 0 || showCreateOption) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
            <ul className="max-h-60 overflow-auto">
              {suggestions.slice(0, 15).map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(tag);
                    }}
                  >
                    <span className="font-medium">{tag.name}</span>
                    {tag.color && (
                      <span
                        className="ms-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {showCreateOption && (
              <div
                className="border-t bg-muted/40 p-2 space-y-2"
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {t('createNew', { name: trimmed })}
                </p>
                <div className="flex gap-2">
                  <Select value={creatingCategoryId} onValueChange={setCreatingCategoryId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={t('chooseCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    disabled={!creatingCategoryId || createTag.isPending}
                    onClick={() =>
                      createTag.mutate({ name: trimmed, categoryId: creatingCategoryId })
                    }
                  >
                    <Plus className="h-3 w-3" />
                    {createTag.isPending ? t('creating') : t('create')}
                  </button>
                </div>
                {createError && <p className="text-xs text-destructive">{createError}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {!canCreate && trimmed.length > 0 && !exactMatch && (
        <p className="text-xs text-muted-foreground">{t('noMatchEmployee')}</p>
      )}
    </div>
  );
}
