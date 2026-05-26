'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Department, ApiError } from '@/lib/api';

export type TreeNode = Department & { children: TreeNode[] };

export function DepartmentNode({
  node,
  branchId,
  depth = 0,
}: {
  node: TreeNode;
  branchId: string;
  depth?: number;
}) {
  const t = useTranslations('admin.departments');
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [addingChild, setAddingChild] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [childName, setChildName] = useState('');
  const [newName, setNewName] = useState(node.name);

  const refresh = () => qc.invalidateQueries({ queryKey: ['departments'] });

  const createChild = useMutation({
    mutationFn: (name: string) =>
      api.post<Department>('departments', {
        branchId,
        parentDepartmentId: node.id,
        name,
      }),
    onSuccess: () => {
      toast.success(t('toast.created'));
      setChildName('');
      setAddingChild(false);
      setOpen(true);
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('toast.error')),
  });

  const rename = useMutation({
    mutationFn: (name: string) => api.patch<Department>(`departments/${node.id}`, { name }),
    onSuccess: () => {
      toast.success(t('toast.saved'));
      setRenaming(false);
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('toast.error')),
  });

  const archive = useMutation({
    mutationFn: () => api.post<{ archived: true }>(`departments/${node.id}/archive`, {}),
    onSuccess: () => {
      toast.success(t('toast.archived'));
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('toast.error')),
  });

  const hasChildren = node.children.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md py-1.5 pe-2 ps-1 hover:bg-muted/50"
        style={{ marginInlineStart: `${depth * 16}px` }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={open ? t('actions.collapse') : t('actions.expand')}
          disabled={!hasChildren}
        >
          {hasChildren ? <Chevron className="h-4 w-4" /> : <span className="h-4 w-4" />}
        </button>

        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) rename.mutate(newName.trim());
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-7"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={rename.isPending}>
              {t('actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenaming(false);
                setNewName(node.name);
              }}
            >
              {t('actions.cancel')}
            </Button>
          </form>
        ) : (
          <>
            <span className="flex-1 truncate text-sm font-medium">{node.name}</span>
            {node.isAutoCreated && (
              <Badge variant="outline" className="text-xs">
                {t('autoCreated')}
              </Badge>
            )}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setAddingChild(true)}
                title={t('actions.addChild')}
              >
                <Plus className="h-4 w-4" />
                <span className="sr-only">{t('actions.addChild')}</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setRenaming(true)}
                title={t('actions.rename')}
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">{t('actions.rename')}</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => archive.mutate()}
                disabled={archive.isPending}
                title={t('actions.archive')}
              >
                <Archive className="h-4 w-4" />
                <span className="sr-only">{t('actions.archive')}</span>
              </Button>
            </div>
          </>
        )}
      </div>

      {addingChild && (
        <div
          className="flex items-center gap-2 ps-8 pe-2 py-1"
          style={{ marginInlineStart: `${depth * 16}px` }}
        >
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (childName.trim()) createChild.mutate(childName.trim());
            }}
          >
            <Input
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder={t('newChildPlaceholder')}
              className="h-7"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={createChild.isPending}>
              {t('actions.create')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAddingChild(false);
                setChildName('');
              }}
            >
              {t('actions.cancel')}
            </Button>
          </form>
        </div>
      )}

      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <DepartmentNode key={c.id} node={c} branchId={branchId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
