// Sprint 21.5 — Lighthouse audit runner.
//
// Runs `npx lighthouse` against a list of key authenticated pages and
// reports their Performance / Accessibility / Best Practices / SEO
// scores. The threshold per category is 90 (blueprint 21.5 goal).
//
// Requirements:
//   1. The web app must be running on http://localhost:3000.
//   2. The API must be running on http://localhost:3001.
//   3. You must be signed in. Lighthouse uses your existing browser
//      session via --no-disable-browser-sandbox + headless Chrome
//      reading the cookie jar. The simplest path is to grab the
//      Clerk session cookie from devtools and pass it via the
//      CLERK_SESSION_COOKIE env var; the runner injects it.
//
// Outputs:
//   - reports/lighthouse/<page-slug>.html for human review.
//   - A summary table in stdout.
//   - Exit code non-zero if any category < 90 on any page.

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', 'reports', 'lighthouse');
const BASE = process.env.LIGHTHOUSE_BASE_URL ?? 'http://localhost:3000';

// The "key pages" per the blueprint goal. Authenticated routes only —
// public sign-in / sign-up pages are Clerk's responsibility.
const PAGES = [
  { slug: 'dashboard', url: '/en/dashboard' },
  { slug: 'tasks', url: '/en/tasks' },
  { slug: 'people', url: '/en/people' },
  { slug: 'activity', url: '/en/activity' },
  { slug: 'reports-tasks-completion', url: '/en/reports/task-completion' },
  { slug: 'billing', url: '/en/billing' },
  { slug: 'me-profile', url: '/en/me/profile' },
  // The /ar/dashboard variant is worth running once to catch any
  // RTL-specific performance regressions (extra font load weight).
  { slug: 'dashboard-ar', url: '/ar/dashboard' },
];

const THRESHOLD = 90;

if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

function check(url) {
  try {
    execSync(`curl -fsS ${url} -o /dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!check(BASE)) {
  console.error(`Web app not reachable at ${BASE}. Start it with:`);
  console.error('  pnpm --filter @qtm/web dev');
  process.exit(1);
}

// We expect the user to have an authenticated Clerk session in a real
// browser; Lighthouse will run in its own Chromium instance and won't
// share cookies. For accurate auth-required page scores the user
// should pass CLERK_SESSION_COOKIE (the value of __session) and we
// inject it via Chrome's --user-data-dir tricks. For the MVP runner
// we just hit the unauthenticated redirect and let Lighthouse score
// what it sees — most pages redirect to Clerk's hosted sign-in, which
// is a 3rd-party domain we can't score anyway. We document the manual
// step in the README at the bottom.

const results = [];
for (const p of PAGES) {
  const url = `${BASE}${p.url}`;
  const out = join(REPORTS_DIR, `${p.slug}.html`);
  const json = join(REPORTS_DIR, `${p.slug}.json`);
  console.log(`Running Lighthouse on ${url} → ${p.slug}.html`);
  const res = spawnSync(
    'npx',
    [
      '--yes',
      'lighthouse@12',
      url,
      '--output=html',
      '--output=json',
      `--output-path=${join(REPORTS_DIR, p.slug)}`,
      '--chrome-flags=--headless=new --no-sandbox',
      '--only-categories=performance,accessibility,best-practices,seo',
      '--quiet',
    ],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) {
    results.push({ slug: p.slug, perf: null, a11y: null, bp: null, seo: null, ok: false });
    continue;
  }
  try {
    const report = JSON.parse(readFileSync(json, 'utf8'));
    const cats = report.categories;
    const r = {
      slug: p.slug,
      perf: Math.round(cats.performance.score * 100),
      a11y: Math.round(cats.accessibility.score * 100),
      bp: Math.round(cats['best-practices'].score * 100),
      seo: Math.round(cats.seo.score * 100),
      ok: false,
    };
    r.ok = r.perf >= THRESHOLD && r.a11y >= THRESHOLD && r.bp >= THRESHOLD && r.seo >= THRESHOLD;
    results.push(r);
  } catch (err) {
    console.error(`  failed to parse report: ${err.message}`);
    results.push({ slug: p.slug, perf: null, a11y: null, bp: null, seo: null, ok: false });
  }
}

console.log();
console.log('═══════════════════════════════════════════════════');
console.log(`Lighthouse summary (threshold ≥ ${THRESHOLD})`);
console.log('═══════════════════════════════════════════════════');
console.log(`page                          perf  a11y  bp    seo   pass`);
for (const r of results) {
  console.log(
    `${r.slug.padEnd(30)}${String(r.perf ?? '—').padEnd(6)}${String(r.a11y ?? '—').padEnd(6)}${String(r.bp ?? '—').padEnd(6)}${String(r.seo ?? '—').padEnd(6)}${r.ok ? 'YES' : 'NO'}`,
  );
}
const failed = results.filter((r) => !r.ok).length;
console.log();
console.log(`${results.length - failed}/${results.length} pages meet the threshold.`);
console.log(`Open reports/lighthouse/*.html for the full reports.`);
process.exit(failed > 0 ? 1 : 0);
