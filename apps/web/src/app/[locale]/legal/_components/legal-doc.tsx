import { getTranslations } from 'next-intl/server';

// Sprint 21.9 — Legal doc renderer.
//
// Three documents (Terms / Privacy / DPA) share the same layout: a
// pending-review banner at the top, a meta line (last updated +
// jurisdiction placeholder), then sections each with a heading +
// markdown-ish paragraphs. The body strings are AI-baseline drafts
// flagged for counsel review.
//
// IMPORTANT: these documents are NOT legally binding until reviewed
// by counsel. The banner makes that explicit to the user; the
// followups list tracks the engagement. We surface the routes anyway
// so the plumbing is complete — when counsel-revised text arrives,
// only the i18n bundle changes.

type Section = { key: string };

type Props = {
  namespace: string; // 'legal.terms' | 'legal.privacy' | 'legal.dpa'
  sections: Section[];
};

export async function LegalDocPage({ namespace, sections }: Props) {
  const t = await getTranslations(namespace);
  const tBanner = await getTranslations('legal.banner');
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-10">
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold">{tBanner('title')}</p>
        <p className="mt-1 text-muted-foreground">{tBanner('body')}</p>
      </div>

      <header className="space-y-1 border-b pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {t('eyebrow')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('meta')}</p>
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
            <Paragraphs body={t(`sections.${s.key}.body`)} />
          </section>
        ))}
      </div>
    </main>
  );
}

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
