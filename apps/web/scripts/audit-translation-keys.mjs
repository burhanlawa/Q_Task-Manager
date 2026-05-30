// Sprint 21.1 — audit translation keys across en / ar / ckb.
//
// Strategy:
//   1. Load all three messages files, flatten to dot-paths.
//   2. Compute the union of all keys across the three locales.
//   3. For each locale, report:
//        - missing keys (present elsewhere, absent here)
//        - empty-string values (likely placeholder)
//        - English residue in ar/ckb (heuristic: ASCII-only value
//          longer than 3 chars that doesn't look like a placeholder
//          token or technical literal)
//   4. Exit non-zero if any locale is missing keys.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, '..', 'messages');

const LOCALES = ['en', 'ar', 'ckb'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, path, out);
    } else {
      out[path] = v;
    }
  }
  return out;
}

const bundles = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    flatten(JSON.parse(readFileSync(join(MESSAGES_DIR, `${l}.json`), 'utf8'))),
  ]),
);

const allKeys = new Set();
for (const l of LOCALES) for (const k of Object.keys(bundles[l])) allKeys.add(k);

console.log(`Total unique keys: ${allKeys.size}`);
for (const l of LOCALES) {
  console.log(`  ${l}: ${Object.keys(bundles[l]).length}`);
}
console.log();

let missingTotal = 0;
const reports = {};
for (const l of LOCALES) {
  const missing = [];
  const empty = [];
  for (const k of allKeys) {
    const v = bundles[l][k];
    if (v === undefined) missing.push(k);
    else if (v === '' || v === null) empty.push(k);
  }
  reports[l] = { missing, empty };
  missingTotal += missing.length;
}

for (const l of LOCALES) {
  const { missing, empty } = reports[l];
  console.log(`── ${l} ─────────────────────────────────`);
  console.log(`  Missing keys: ${missing.length}`);
  for (const k of missing.slice(0, 25)) console.log(`    - ${k}`);
  if (missing.length > 25) console.log(`    ... +${missing.length - 25} more`);
  console.log(`  Empty values: ${empty.length}`);
  for (const k of empty.slice(0, 10)) console.log(`    - ${k}`);
  if (empty.length > 10) console.log(`    ... +${empty.length - 10} more`);
}

// English-residue heuristic for ar/ckb only.
//   - Skip ICU placeholders like {count}, {date}.
//   - Skip pure technical literals (env var names, URLs).
//   - Treat as suspicious: a value that is mostly ASCII letters with
//     no Arabic-range characters (؀-ۿ, ݐ-ݿ).
const ARABIC_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
function looksLikeEnglishResidue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length <= 3) return false;
  // Strip placeholder tokens, URLs, env vars to evaluate the meaningful part.
  const stripped = trimmed
    .replace(/\{[^}]+\}/g, '')           // {count} etc.
    .replace(/https?:\/\/\S+/g, '')      // URLs
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, '') // ENV_VARS
    .replace(/[0-9]/g, '')
    .trim();
  if (stripped.length <= 3) return false;
  return !ARABIC_RANGE.test(stripped);
}

console.log();
for (const l of ['ar', 'ckb']) {
  const suspicious = [];
  for (const [k, v] of Object.entries(bundles[l])) {
    if (looksLikeEnglishResidue(v)) suspicious.push([k, v]);
  }
  console.log(`── ${l}: English-residue candidates ─────────────────`);
  console.log(`  ${suspicious.length} string(s)`);
  for (const [k, v] of suspicious.slice(0, 20)) {
    console.log(`    ${k} = "${v.length > 80 ? v.slice(0, 80) + '…' : v}"`);
  }
  if (suspicious.length > 20) console.log(`    ... +${suspicious.length - 20} more`);
}

console.log();
if (missingTotal === 0) {
  console.log('OK   no missing keys across any locale.');
} else {
  console.log(`FAIL ${missingTotal} missing key(s) total. See above.`);
}
process.exit(missingTotal === 0 ? 0 : 1);
