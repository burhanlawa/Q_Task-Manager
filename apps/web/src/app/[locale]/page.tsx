import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-10 p-8">
      <h1 className="text-5xl font-bold tracking-tight">{t('app.title')}</h1>

      <Card className="w-full max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
        <CardHeader>
          <CardTitle>{t('demo.heading')}</CardTitle>
          <CardDescription>{t('demo.explainer')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center">
            <span className="inline-block size-4 rounded bg-primary" />
            <span className="ms-4 text-sm">{t('demo.logicalLabel')}</span>
          </div>
          <div className="flex items-center">
            <span className="inline-block size-4 rounded bg-destructive" />
            <span className="ml-4 text-sm">{t('demo.physicalLabel')}</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
