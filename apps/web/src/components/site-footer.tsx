import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

// Brand attribution shown at the bottom of every page. The agency name
// is intentionally NOT translated (it's a brand). Legal links land in
// the same row — Sprint 21.9 requires Terms / Privacy / DPA to be
// reachable from the footer + at signup.

export async function SiteFooter() {
  const t = await getTranslations('footer');
  return (
    <footer className="mt-12 border-t py-4 text-center text-xs text-muted-foreground">
      <p>Powered by Quantum Tech Agency</p>
      <nav className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        <Link href="/legal/terms" className="hover:text-foreground hover:underline">
          {t('terms')}
        </Link>
        <Link href="/legal/privacy" className="hover:text-foreground hover:underline">
          {t('privacy')}
        </Link>
        <Link href="/legal/dpa" className="hover:text-foreground hover:underline">
          {t('dpa')}
        </Link>
      </nav>
    </footer>
  );
}
