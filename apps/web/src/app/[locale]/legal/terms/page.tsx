import { LegalDocPage } from '../_components/legal-doc';

const SECTIONS = [
  { key: 'acceptance' },
  { key: 'service' },
  { key: 'accounts' },
  { key: 'subscriptions' },
  { key: 'acceptableUse' },
  { key: 'content' },
  { key: 'termination' },
  { key: 'disclaimer' },
  { key: 'liability' },
  { key: 'changes' },
  { key: 'contact' },
];

export default function TermsPage() {
  return <LegalDocPage namespace="legal.terms" sections={SECTIONS} />;
}
