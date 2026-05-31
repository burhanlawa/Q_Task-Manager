import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { HelpPage, type SectionShape } from './_components/help-page';

// Sprint 21.7 — Help index / Getting started.
//
// First page a customer hits from the sidebar Help link. Covers the
// path from signup to "your team is working in the app." Doubles as
// the landing page that links out to the Admin and Employee guides.

const SECTIONS: SectionShape[] = [
  { key: 'signup' },
  { key: 'verifyEmail' },
  { key: 'orgSetup' },
  { key: 'inviteFirstTeammate', variant: 'list-ordered', itemCount: 4 },
  { key: 'createFirstTask', variant: 'list-ordered', itemCount: 5 },
  { key: 'nextSteps' },
];

export default async function HelpIndexPage() {
  const t = await getTranslations('help.gettingStarted');
  return (
    <>
      <HelpPage namespace="help.gettingStarted" sections={SECTIONS} />
      <section className="mx-auto max-w-3xl space-y-3 px-6 pb-10 md:px-10">
        <h2 className="text-lg font-semibold tracking-tight">{t('crosslinks.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/help/admin"
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <p className="font-medium">{t('crosslinks.admin.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('crosslinks.admin.description')}
            </p>
          </Link>
          <Link
            href="/help/employee"
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <p className="font-medium">{t('crosslinks.employee.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('crosslinks.employee.description')}
            </p>
          </Link>
        </div>
      </section>
    </>
  );
}
