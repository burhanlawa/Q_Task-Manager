'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';

const MIN_REASON_LENGTH = 10;

type Props = {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CancelTaskDialog({ taskId, open, onOpenChange }: Props) {
  const t = useTranslations('tasks.cancel');
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    // The transition endpoint accepts { note }; we surface it to the user as
    // "cancellation reason" since that's its only role for cancel.
    mutationFn: (body: { note: string }) => api.post(`tasks/${taskId}/cancel`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['task', taskId], updated);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
      setReason('');
      setError(null);
      onOpenChange(false);
    },
    onError: (err: ApiError) => setError(err.message || t('errors.generic')),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setError(t('errors.tooShort', { min: MIN_REASON_LENGTH }));
      return;
    }
    submit.mutate({ note: trimmed });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              {t('reasonLabel')}
              <span className="ms-1 text-destructive">*</span>
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={MIN_REASON_LENGTH}
              maxLength={2000}
              rows={5}
              placeholder={t('reasonPlaceholder')}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t('charCount', { count: reason.trim().length, min: MIN_REASON_LENGTH })}
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submit.isPending}
            >
              {t('keep')}
            </Button>
            <Button type="submit" variant="destructive" disabled={submit.isPending}>
              {submit.isPending ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
