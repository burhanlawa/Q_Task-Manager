'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type Branch, type Department, ApiError } from '@/lib/api';
import { DepartmentNode, type TreeNode } from './department-node';

function buildTree(departments: Department[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const d of departments) byId.set(d.id, { ...d, children: [] });
  const roots: TreeNode[] = [];
  for (const d of departments) {
    const node = byId.get(d.id)!;
    if (d.parentDepartmentId && byId.has(d.parentDepartmentId)) {
      byId.get(d.parentDepartmentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function DepartmentsTree() {
  const t = useTranslations('admin.departments');
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState<string>('');
  const [addingRoot, setAddingRoot] = useState(false);
  const [rootName, setRootName] = useState('');

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches', { status: 'active' }],
    queryFn: () => api.get('branches?status=active'),
  });

  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: departments, isLoading } = useQuery<Department[]>({
    queryKey: ['departments', { branchId, status: 'active' }],
    queryFn: () => api.get(`departments?status=active&branchId=${branchId}`),
    enabled: !!branchId,
  });

  const tree = useMemo(() => (departments ? buildTree(departments) : []), [departments]);

  const createRoot = useMutation({
    mutationFn: (name: string) =>
      api.post<Department>('departments', { branchId, name }),
    onSuccess: () => {
      toast.success(t('toast.created'));
      setRootName('');
      setAddingRoot(false);
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('toast.error')),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t('branchLabel')}</label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder={t('branchPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {branches?.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setAddingRoot(true)} disabled={!branchId}>
          <Plus className="me-2 h-4 w-4" />
          {t('newRoot')}
        </Button>
      </div>

      {addingRoot && (
        <form
          className="flex items-center gap-2 rounded-md border bg-muted/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rootName.trim()) createRoot.mutate(rootName.trim());
          }}
        >
          <Input
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            placeholder={t('newRootPlaceholder')}
            autoFocus
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={createRoot.isPending}>
            {t('actions.create')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddingRoot(false);
              setRootName('');
            }}
          >
            {t('actions.cancel')}
          </Button>
        </form>
      )}

      <div className="rounded-md border p-2">
        {isLoading && <p className="p-4 text-muted-foreground">{t('loading')}</p>}
        {!isLoading && tree.length === 0 && (
          <p className="p-4 text-muted-foreground">{t('empty')}</p>
        )}
        <ul>
          {tree.map((node) => (
            <DepartmentNode key={node.id} node={node} branchId={branchId} />
          ))}
        </ul>
      </div>
    </div>
  );
}
