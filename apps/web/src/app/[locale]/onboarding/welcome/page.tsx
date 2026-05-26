import { getTranslations } from 'next-intl/server';
import { OnboardingForm } from './_components/onboarding-form';

export default async function OnboardingWelcomePage() {
  const t = await getTranslations('onboarding.welcome');
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <OnboardingForm />
    </main>
  );
}
