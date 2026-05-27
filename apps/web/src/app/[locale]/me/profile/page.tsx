import { getTranslations } from 'next-intl/server';
import { ProfileFilesSection } from './_components/profile-files-section';
import { ProfileForm } from './_components/profile-form';

export default async function MyProfilePage() {
  const t = await getTranslations('me.profile');
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <ProfileForm />
      <ProfileFilesSection />
    </main>
  );
}
