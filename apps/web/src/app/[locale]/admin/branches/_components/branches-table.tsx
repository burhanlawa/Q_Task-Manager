'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { Archive, ArchiveRestore, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type Branch, ApiError } from '@/lib/api';

type StatusFilter = 'active' | 'archived' | 'all';

export function BranchesTable() {
  const t = useTranslations('admin.branches');
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('active');

  const { data, isLoading, isError } = useQuery<Branch[]>({
    queryKey: ['branches', { status }],
    queryFn: () => api.get(`branches?status=${status}`),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.post<{ archived: true }>(`branches/${id}/archive`, {}),
    onSuccess: () => {
      toast.success(t('toast.archived'));
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const unarchive = useMutation({
    mutationFn: (id: string) => api.post<{ archived: false }>(`branches/${id}/unarchive`, {}),
    onSuccess: () => {
      toast.success(t('toast.unarchived'));
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="active">{t('filter.active')}</TabsTrigger>
          <TabsTrigger value="archived">{t('filter.archived')}</TabsTrigger>
          <TabsTrigger value="all">{t('filter.all')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.city')}</TableHead>
              <TableHead>{t('columns.country')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className="text-end">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-destructive py-8">
                  {t('loadError')}
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {data?.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell>{b.city ?? '—'}</TableCell>
                <TableCell>{b.country ?? '—'}</TableCell>
                <TableCell>
                  {b.deletedAt ? (
                    <Badge variant="outline">{t('status.archived')}</Badge>
                  ) : (
                    <Badge>{t('status.active')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex items-center justify-end gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/branches/${b.id}`}>
                        <ExternalLink className="h-4 w-4" />
                        <span className="sr-only">{t('actions.open')}</span>
                      </Link>
                    </Button>
                    {b.deletedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unarchive.mutate(b.id)}
                        disabled={unarchive.isPending}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                        <span className="sr-only">{t('actions.unarchive')}</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archive.mutate(b.id)}
                        disabled={archive.isPending}
                      >
                        <Archive className="h-4 w-4" />
                        <span className="sr-only">{t('actions.archive')}</span>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
