// Sprint 21.3 verify — render representative email templates per
// locale, save each HTML to /tmp, and assert RTL attributes are
// present in ar/ckb output. Visual inspection of /tmp/qtm-email-*.html
// in a browser is the next step; live-client testing (Gmail / Outlook
// / Apple Mail) needs real sends via /emails/debug-send.

import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { EmailTemplateService } = await import('../dist/emails/templates/render.js');
const svc = new EmailTemplateService();

// Representative coverage: every email type × 3 locales. 14 types × 3 =
// 42 files. The vars set is the same for every type — render.ts only
// uses the keys it needs and silently leaves unknown placeholders.
const TYPES = [
  'task_assigned',
  'task_submitted',
  'task_approved',
  'task_revision_requested',
  'task_cancelled',
  'task_reassignment_requested',
  'comment_mentioned',
  'comment_created',
  'broadcast',
  'deadline_approaching',
  'overdue',
  'onboarding_approval',
  'new_employee',
  'leave_reminder',
];
const LOCALES = ['en', 'ar', 'ckb'];

const VARS = {
  recipientName: 'Burhan',
  actorName: 'Lawa',
  taskTitle: 'Q3 marketing plan',
  dueDate: '2026-06-15',
  companyName: 'Quantum Tech Agency',
  newUserName: 'Sara',
  leaveDate: '2026-06-20',
  title: 'Office closed Thursday',
  messageBody: 'Reminder: the office is closed for Eid; rejoin Monday.',
};

const results = [];
function ok(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const outDir = tmpdir();
let firstAr = '';
let firstEn = '';

for (const type of TYPES) {
  for (const locale of LOCALES) {
    const rendered = svc.render(type, locale, VARS);
    const filename = `qtm-email-${locale}-${type}.html`;
    const path = join(outDir, filename);
    writeFileSync(path, rendered.html);

    // Hold onto a sample for cross-checks below.
    if (locale === 'ar' && !firstAr) firstAr = rendered.html;
    if (locale === 'en' && !firstEn) firstEn = rendered.html;

    // Per-render assertions.
    const expectedDir = locale === 'ar' || locale === 'ckb' ? 'rtl' : 'ltr';
    const hasDir = rendered.html.includes(`dir="${expectedDir}"`);
    const hasLang = rendered.html.includes(`lang="${locale}"`);
    const hasSubject = rendered.subject.length > 0 && !rendered.subject.includes('{');
    const hasBody = rendered.text.length > 0;
    const allOk = hasDir && hasLang && hasSubject && hasBody;
    if (!allOk) {
      ok(`render ${locale}/${type}`, false, `dir=${hasDir} lang=${hasLang} subj=${hasSubject} body=${hasBody}`);
    }
  }
}

// Summary assertion: ALL 42 (we only logged failures above).
ok(`rendered ${TYPES.length} types × ${LOCALES.length} locales`, results.every((r) => r.passed));

// RTL spot-check on the first ar render. Confirms:
//  - <html dir="rtl"> at the top
//  - text-align:right somewhere in the body cell
//  - placeholders interpolated, not leaked
ok('ar render has dir="rtl"', firstAr.includes('dir="rtl"'));
ok('ar render has text-align:right', firstAr.includes('text-align:right'));
ok('ar render interpolated recipientName', firstAr.includes('Burhan'));
ok('ar render did not leak {recipientName}', !firstAr.includes('{recipientName}'));

// LTR sanity on en.
ok('en render has dir="ltr"', firstEn.includes('dir="ltr"'));
ok('en render has text-align:left', firstEn.includes('text-align:left'));

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
console.log(`\nWrote ${TYPES.length * LOCALES.length} HTML files to ${outDir}/qtm-email-*.html`);
console.log('Open a few in your browser to spot-check RTL layout, then');
console.log('use POST /emails/debug-send for live Gmail / Outlook / Apple Mail tests.');
process.exit(failed > 0 ? 1 : 0);
