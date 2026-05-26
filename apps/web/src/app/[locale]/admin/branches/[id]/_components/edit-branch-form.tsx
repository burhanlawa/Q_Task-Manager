'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api, type Branch, ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(20).optional().or(z.literal('')),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, { message: 'ISO-3166 alpha-2 (uppercase)' })
    .optional()
    .or(z.literal('')),
  city: z.string().max(120).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  timezone: z.string().max(64).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function EditBranchForm({ branchId }: { branchId: string }) {
  const t = useTranslations('admin.branches');
  const qc = useQueryClient();

  const { data: branch, isLoading } = useQuery<Branch>({
    queryKey: ['branches', branchId],
    queryFn: () => api.get(`branches/${branchId}`),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', code: '', country: '', city: '', address: '', timezone: '' },
  });

  useEffect(() => {
    if (branch) {
      form.reset({
        name: branch.name,
        code: branch.code ?? '',
        country: branch.country ?? '',
        city: branch.city ?? '',
        address: branch.address ?? '',
        timezone: branch.timezone ?? '',
      });
    }
  }, [branch, form]);

  const update = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: Record<string, string | undefined> = {};
      for (const k of ['name', 'code', 'country', 'city', 'address', 'timezone'] as const) {
        const v = values[k];
        if (v !== '') payload[k] = v;
      }
      return api.patch<Branch>(`branches/${branchId}`, payload);
    },
    onSuccess: () => {
      toast.success(t('toast.saved'));
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (!branch) return <p className="text-destructive">{t('loadError')}</p>;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => update.mutate(v))} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.code')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.country')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="IQ" maxLength={2} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.city')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.address')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.timezone')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Asia/Baghdad" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
