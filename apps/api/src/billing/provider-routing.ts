// Sprint 20.2 — which checkout provider should this company see?
//
// Paddle is the primary (v2.0 blueprint decision). Stripe is the
// fallback for tenants whose country Paddle doesn't onboard. The list
// below is conservative — countries where Paddle has documented
// limitations or has historically refused merchant onboarding. It is
// NOT the inverse list (Stripe's coverage). Adding a country to this
// set just means "we prefer Stripe here"; tenants in any other country
// see the Paddle checkout by default.
//
// ISO 3166-1 alpha-2 codes, matching companies.country.

const PADDLE_UNSUPPORTED_COUNTRIES: ReadonlySet<string> = new Set([
  // High-risk / sanctioned / Paddle-restricted jurisdictions. Iraq is
  // the immediate trigger (see followups) but the list is here so we
  // don't have to revisit when the next blocked region surfaces.
  'IQ', // Iraq
  'IR', // Iran
  'SY', // Syria
  'KP', // North Korea
  'CU', // Cuba
  'AF', // Afghanistan
  'YE', // Yemen
  'LY', // Libya
  'SS', // South Sudan
  'VE', // Venezuela
]);

export type CheckoutProvider = 'paddle' | 'stripe';

export function pickCheckoutProvider(countryCode: string | null | undefined): CheckoutProvider {
  if (!countryCode) return 'paddle';
  return PADDLE_UNSUPPORTED_COUNTRIES.has(countryCode.toUpperCase()) ? 'stripe' : 'paddle';
}
