import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

// Sprint 21.7 — Help page renderer.
//
// Each help page (getting-started / admin / employee) has the same
// shape: a title, a description, and N sections each with a heading +
// markdown-ish body. We render in JSX rather than parsing markdown so
// every string flows through the existing next-intl bundle — that
// keeps it translatable AND auditable via `pnpm audit:i18n`.
//
// Sections support a simple body schema:
//   - paragraph: free text (use \n\n for paragraph breaks)
//   - list: ordered/unordered with bullet items
// Pages declare their sections by key prefix (e.g.
// 'help.gettingStarted.sections.signup'); the renderer pulls
// title + body + (optional) listItems for each.

export type SectionShape = {
  /** i18n key relative to the page namespace, e.g. 'signup' */
  key: string;
  /** 'list' renders an <ol>/<ul>; default is paragraph(s). */
  variant?: 'paragraph' | 'list-ordered' | 'list-unordered';
  /** Number of items if variant is a list. Each item lives at `${key}.items.${i+1}`. */
  itemCount?: number;
};

type Props = {
  namespace: string; // e.g. 'help.admin'
  sections: SectionShape[];
};

export async function HelpPage({ namespace, sections }: Props) {
  const t = await getTranslations(namespace);
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-10">
      <header className="space-y-1 border-b pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {t('eyebrow')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <nav aria-label={t('tocLabel')} className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="mb-2 font-medium text-muted-foreground">{t('tocLabel')}</p>
        <ul className="space-y-1">
          {sections.map((s) => (
            <li key={s.key}>
              <a href={`#${s.key}`} className="text-primary hover:underline">
                {t(`sections.${s.key}.title`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-10">
        {sections.map((s) => (
          <section key={s.key} id={s.key} className="space-y-3 scroll-mt-20">
            <h2 className="text-xl font-semibold tracking-tight">
              {t(`sections.${s.key}.title`)}
            </h2>
            {s.variant === 'list-ordered' || s.variant === 'list-unordered' ? (
              s.variant === 'list-ordered' ? (
                <ol className="list-decimal space-y-2 ps-6 text-sm text-foreground/90">
                  {Array.from({ length: s.itemCount ?? 0 }, (_, i) => (
                    <li key={i}>{t(`sections.${s.key}.items.${i + 1}`)}</li>
                  ))}
                </ol>
              ) : (
                <ul className="list-disc space-y-2 ps-6 text-sm text-foreground/90">
                  {Array.from({ length: s.itemCount ?? 0 }, (_, i) => (
                    <li key={i}>{t(`sections.${s.key}.items.${i + 1}`)}</li>
                  ))}
                </ul>
              )
            ) : (
              <Paragraphs body={t(`sections.${s.key}.body`)} />
            )}
          </section>
        ))}
      </div>

      <footer className="border-t pt-6 text-sm text-muted-foreground">
        <p>
          {t.rich('footer.cta', {
            link: (chunks) => (
              <Link href="/help" className="text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </footer>
    </main>
  );
}

// Split \n\n-separated text into <p> blocks. Avoids needing a markdown
// renderer for the common case of "a paragraph or two of prose".
function Paragraphs({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {blocks.map((b, i) => (
        <p key={i}>{b}</p>
      ))}
    </div>
  );
}
