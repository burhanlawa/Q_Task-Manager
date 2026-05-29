'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

type Sender = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
} | null;

type BroadcastListItem = {
  id: string;
  title: string;
  body: string;
  audience: string;
  audienceSize: number | null;
  sender: Sender;
  createdAt: string;
};

type ListResponse = {
  sent: BroadcastListItem[];
  received: BroadcastListItem[];
};

export function BroadcastsList() {
  const t = useTranslations('broadcasts.list');
  const locale = useLocale();

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ['broadcasts', 'list'],
    queryFn: () => api.get('broadcasts'),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-muted-foreground">{t('loadError')}</p>;
  }

  const sent = data.sent;
  const received = data.received;
  // Default to whichever tab has content; sent takes priority when both
  // are non-empty (you're more likely to come here to verify a send).
  const defaultTab = sent.length > 0 ? 'sent' : 'received';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/broadcasts/new">{t('newButton')}</Link>
        </Button>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="received">
            {t('tabs.received', { count: received.length })}
          </TabsTrigger>
          <TabsTrigger value="sent">{t('tabs.sent', { count: sent.length })}</TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="mt-4">
          {received.length === 0 ? (
            <p className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              {t('empty.received')}
            </p>
          ) : (
            <ul className="space-y-3">
              {received.map((b) => (
                <BroadcastRow key={b.id} b={b} locale={locale} t={t} showAudience={false} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          {sent.length === 0 ? (
            <p className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              {t('empty.sent')}
            </p>
          ) : (
            <ul className="space-y-3">
              {sent.map((b) => (
                <BroadcastRow key={b.id} b={b} locale={locale} t={t} showAudience={true} />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BroadcastRow({
  b,
  locale,
  t,
  showAudience,
}: {
  b: BroadcastListItem;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  showAudience: boolean;
}) {
  const senderName = b.sender?.displayName ?? b.sender?.firstName ?? b.sender?.email ?? null;
  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium">{b.title}</h2>
        <span className="text-xs text-muted-foreground">{formatDate(b.createdAt, locale)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{b.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {senderName && <span>— {senderName}</span>}
        {showAudience && (
          <>
            <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 font-medium">
              {b.audience}
            </span>
            {b.audienceSize !== null && (
              <span>{t('audienceSize', { count: b.audienceSize })}</span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
