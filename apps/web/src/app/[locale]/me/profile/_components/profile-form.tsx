'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
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
import { api, type Branch, type Department, ApiError } from '@/lib/api';

type Me = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phone: string | null;
  locale: string;
  timezone: string | null;
  orgRole: string;
  status: string;
  employmentStatus: string;
  branchId: string | null;
  departmentId: string | null;
  dateOfBirth: string | null;
  company: { id: string; name: string; slug: string; status: string; country: string };
};

const schema = z.object({
  firstName: z.string().min(1).max(80).optional().or(z.literal('')),
  lastName: z.string().min(1).max(80).optional().or(z.literal('')),
  displayName: z.string().min(1).max(120).optional().or(z.literal('')),
  phone: z.string().min(5).max(32).optional().or(z.literal('')),
  locale: z.string().min(2).max(5),
  timezone: z.string().max(64).optional().or(z.literal('')),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'YYYY-MM-DD' })
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function ProfileForm() {
  const t = useTranslations('me.profile');
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      displayName: '',
      phone: '',
      locale: 'en',
      timezone: '',
      dateOfBirth: '',
    },
  });

  const { data: me, isLoading } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
  });
  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches', { status: 'all' }],
    queryFn: () => api.get('branches?status=all'),
  });
  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'all' }],
    queryFn: () => api.get('departments?status=all'),
  });

  useEffect(() => {
    if (me) {
      form.reset({
        firstName: me.firstName ?? '',
        lastName: me.lastName ?? '',
        displayName: me.displayName ?? '',
        phone: me.phone ?? '',
        locale: me.locale,
        timezone: me.timezone ?? '',
        dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
      });
    }
  }, [me, form]);

  const update = useMutation({
    mutationFn: (v: FormValues) => {
      // Convert empty strings to null so the API knows to clear the field.
      const payload: Record<string, string | null> = { locale: v.locale };
      for (const k of ['firstName', 'lastName', 'displayName', 'phone', 'timezone', 'dateOfBirth'] as const) {
        const val = v[k];
        if (val !== undefined) payload[k] = val === '' ? null : val;
      }
      return api.patch<Me>('me', payload);
    },
    onSuccess: () => {
      toast.success(t('toast.saved'));
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('toast.error')),
  });

  if (isLoading) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (!me) return <p className="text-destructive">{t('loadError')}</p>;

  const branchName = me.branchId
    ? (branches?.find((b) => b.id === me.branchId)?.name ?? me.branchId)
    : '—';
  const deptName = me.departmentId
    ? (departments?.find((d) => d.id === me.departmentId)?.name ?? me.departmentId)
    : '—';

  return (
    <div className="space-y-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => update.mutate(v))} className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('sections.personal')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.firstName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.lastName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t('fields.displayName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.phone')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+964 …" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.dateOfBirth')}</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.locale')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={5} placeholder="en | ar | ckb" />
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
            </div>
            <div className="pt-1">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t('actions.saving') : t('actions.save')}
              </Button>
            </div>
          </section>
        </form>
      </Form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sections.organizational')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('sections.organizationalHint')}</p>
        <dl className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
          <LockedField label={t('fields.email')} value={me.email} />
          <LockedField label={t('fields.orgRole')} value={me.orgRole} badge />
          <LockedField label={t('fields.status')} value={me.status} badge />
          <LockedField label={t('fields.employmentStatus')} value={me.employmentStatus} />
          <LockedField label={t('fields.branch')} value={branchName} />
          <LockedField label={t('fields.department')} value={deptName} />
          <LockedField label={t('fields.company')} value={me.company.name} />
        </dl>
      </section>
    </div>
  );
}

function LockedField({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {badge ? <Badge variant="outline">{value}</Badge> : value}
      </dd>
    </div>
  );
}
