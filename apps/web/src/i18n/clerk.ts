import { enUS, arSA } from '@clerk/localizations';
import type { Locale } from './routing';

type LocalizationResource = typeof enUS;

// Clerk does not ship Sorani Kurdish (ckb). Fall back to Arabic — same script,
// Kurdish speakers in Iraq read both. Replace with a native ckb pack in Sprint 21.
const clerkLocalizations: Record<Locale, LocalizationResource> = {
  en: enUS,
  ar: arSA,
  ckb: arSA,
};

export function getClerkLocalization(locale: Locale): LocalizationResource {
  return clerkLocalizations[locale];
}
