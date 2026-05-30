// Sprint 20.2 verify — pickCheckoutProvider returns the expected branch
// for sample countries. This is the rule /billing/me serves to the
// upgrade page, so a regression here would silently send IQ tenants
// to a checkout that can't onboard them.

const { pickCheckoutProvider } = await import('../dist/billing/provider-routing.js');

const cases = [
  ['IQ', 'stripe'],
  ['iq', 'stripe'], // case-insensitive
  ['IR', 'stripe'],
  ['SY', 'stripe'],
  ['US', 'paddle'],
  ['GB', 'paddle'],
  ['AE', 'paddle'],
  [null, 'paddle'],
  [undefined, 'paddle'],
  ['', 'paddle'],
];

let failed = 0;
for (const [country, expected] of cases) {
  const got = pickCheckoutProvider(country);
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} country=${JSON.stringify(country)} → ${got} (expected ${expected})`);
}

console.log(`\n${cases.length - failed}/${cases.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
