import { LegalDocPage } from '../_components/legal-doc';

const SECTIONS = [
  { key: 'intro' },
  { key: 'dataCollected' },
  { key: 'dataUse' },
  { key: 'dataSharing' },
  { key: 'subprocessors' },
  { key: 'retention' },
  { key: 'security' },
  { key: 'rights' },
  { key: 'cookies' },
  { key: 'children' },
  { key: 'changes' },
  { key: 'contact' },
];

export default function PrivacyPage() {
  return <LegalDocPage namespace="legal.privacy" sections={SECTIONS} />;
}
