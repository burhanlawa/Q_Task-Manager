'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';

// All 13 notification types from Sprint 15.3. Order is fixed so the UI
// always looks the same regardless of what the server returns.
const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_submitted',
  'task_approved',
  'task_revision_requested',
  'task_cancelled',
  'task_reassignment_requested',
  'comment_mentioned',
  'comment_created',
  'deadline_approaching',
  'overdue',
  'onboarding_approval',
  'new_employee',
  'leave_reminder',
] as const;

type Type = (typeof NOTIFICATION_TYPES)[number];
type ChannelPrefs = { in_app?: boolean; email?: boolean };
type Prefs = Record<string, ChannelPrefs>;

// Empty server value = "default", which the writer treats as opted-in.
// Mirror that here: an unset toggle is ON in the UI.
function isOn(p: ChannelPrefs | undefined, channel: 'in_app' | 'email'): boolean {
  return p?.[channel] !== false;
}

export function NotificationPreferencesForm() {
  const t = useTranslations('notificationSettings');
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ types: Prefs }>({
    queryKey: ['me', 'notification-preferences'],
    queryFn: () => api.get('me/notification-preferences'),
  });

  // Local draft state — initialized from server data and edited optimistically.
  // We only PATCH when the user clicks Save so a stray toggle doesn't fire
  // 13 requests in a row.
  const [draft, setDraft] = useState<Prefs>({});
  useEffect(() => {
    if (data?.types) setDraft(data.types);
  }, [data]);

  const save = useMutation({
    mutationFn: (next: Prefs) => api.patch('me/notification-preferences', { types: next }),
    onSuccess: () => {
      toast.success(t('saved'));
      queryClient.invalidateQueries({ queryKey: ['me', 'notification-preferences'] });
    },
    onError: () => toast.error(t('error')),
  });

  function toggle(type: Type, channel: 'in_app' | 'email', next: boolean) {
    setDraft((d) => ({
      ...d,
      [type]: { ...d[type], [channel]: next },
    }));
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('saving')}</p>;
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground" scope="col">
              {/* event column has no header */}
            </th>
            <th className="w-24 px-4 py-3 text-center font-medium" scope="col">
              {t('inApp')}
            </th>
            <th className="w-24 px-4 py-3 text-center font-medium" scope="col">
              {t('email')}
            </th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_TYPES.map((type) => {
            const p = draft[type];
            return (
              <tr key={type} className="border-b last:border-b-0">
                <td className="px-4 py-3 align-middle">{t(`types.${type}`)}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={isOn(p, 'in_app')}
                      onCheckedChange={(v) => toggle(type, 'in_app', v)}
                      aria-label={`${t(`types.${type}`)} — ${t('inApp')}`}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={isOn(p, 'email')}
                      onCheckedChange={(v) => toggle(type, 'email', v)}
                      aria-label={`${t(`types.${type}`)} — ${t('email')}`}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end border-t px-4 py-3">
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          {save.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
