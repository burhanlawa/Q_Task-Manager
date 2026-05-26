'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Plus, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type Team, ApiError } from '@/lib/api';

type StatusFilter = 'active' | 'archived' | 'all';

const createSchema = z.object({
  name: z.string().min(1).max(120),
});
type CreateValues = z.infer<typeof createSchema>;

export function TeamsSection({ departmentId }: { departmentId: string }) {
  const t = useTranslations('admin.teams');
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [createOpen, setCreateOpen] = useState(false);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '' },
  });

  const { data, isLoading, isError } = useQuery<Team[]>({
    queryKey: ['teams', { departmentId, status }],
    queryFn: () => api.get(`teams?departmentId=${departmentId}&status=${status}`),
  });

  const create = useMutation({
    mutationFn: (values: CreateValues) =>
      api.post<Team>('teams', { departmentId, name: values.name }),
    onSuccess: () => {
      toast.success(t('toast.created'));
      qc.invalidateQueries({ queryKey: ['teams'] });
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.post<{ archived: true }>(`teams/${id}/archive`, {}),
    onSuccess: () => {
      toast.success(t('toast.archived'));
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  const unarchive = useMutation({
    mutationFn: (id: string) => api.post<{ archived: false }>(`teams/${id}/unarchive`, {}),
    onSuccess: () => {
      toast.success(t('toast.unarchived'));
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="me-2 h-4 w-4" />
              {t('newTeam')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('createTitle')}</DialogTitle>
              <DialogDescription>{t('createDescription')}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => create.mutate(v))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.name')}</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                    {t('actions.cancel')}
                  </Button>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? t('actions.creating') : t('actions.create')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

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
              <TableHead>{t('columns.supervisor')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className="text-end">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-destructive py-8">
                  {t('loadError')}
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {data?.map((tm) => (
              <TableRow key={tm.id}>
                <TableCell className="font-medium">{tm.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {tm.supervisorId ? (
                    <span className="font-mono text-xs">{tm.supervisorId.slice(0, 8)}…</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      className="h-7 gap-1 text-xs"
                      title={t('assignSupervisorComingSoon')}
                    >
                      <UserPlus className="h-3 w-3" />
                      {t('assignSupervisorComingSoon')}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  {tm.deletedAt ? (
                    <Badge variant="outline">{t('status.archived')}</Badge>
                  ) : (
                    <Badge>{t('status.active')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  {tm.deletedAt ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unarchive.mutate(tm.id)}
                      disabled={unarchive.isPending}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      <span className="sr-only">{t('actions.unarchive')}</span>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archive.mutate(tm.id)}
                      disabled={archive.isPending}
                    >
                      <Archive className="h-4 w-4" />
                      <span className="sr-only">{t('actions.archive')}</span>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
