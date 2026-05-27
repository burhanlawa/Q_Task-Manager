import { getTranslations } from 'next-intl/server';
import { CompanyLogoSection } from './_components/company-logo-section';
import { ImageAttachmentsSection } from './_components/image-attachments-section';

export default async function CompanySettingsPage() {
  const t = await getTranslations('settings.company');
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <CompanyLogoSection />
      <ImageAttachmentsSection />
    </main>
  );
}
