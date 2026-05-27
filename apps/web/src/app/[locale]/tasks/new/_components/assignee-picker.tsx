'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  departmentId: string | null;
};

function nameOf(u: User): string {
  return u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ?? u.email;
}

// Chip + search dropdown. We avoid pulling in a combobox lib for this — the
// people list is small enough (single tenant) that a simple filtered <ul>
// is fast and accessible enough for v1.
export function AssigneePicker({
  users,
  selectedIds,
  onChange,
}: {
  users: User[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('tasks.new.picker');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((u) => !selectedIds.includes(u.id))
      .filter((u) => {
        if (!needle) return true;
        const hay = `${nameOf(u)} ${u.email}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 20);
  }, [users, selectedIds, query]);

  const selected = selectedIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => !!u);

  function add(id: string) {
    onChange([...selectedIds, id]);
    setQuery('');
  }
  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
            >
              {nameOf(u)}
              <button
                type="button"
                onClick={() => remove(u.id)}
                aria-label={t('remove')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('search')}
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(u.id);
                  }}
                >
                  <span className="font-medium">{nameOf(u)}</span>
                  <span className="ms-2 text-xs text-muted-foreground">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
