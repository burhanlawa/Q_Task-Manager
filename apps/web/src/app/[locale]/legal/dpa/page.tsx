import { LegalDocPage } from '../_components/legal-doc';

const SECTIONS = [
  { key: 'scope' },
  { key: 'roles' },
  { key: 'processingScope' },
  { key: 'subprocessors' },
  { key: 'security' },
  { key: 'dataSubjectRights' },
  { key: 'breachNotification' },
  { key: 'transfers' },
  { key: 'audit' },
  { key: 'termination' },
  { key: 'liability' },
  { key: 'contact' },
];

export default function DpaPage() {
  return <LegalDocPage namespace="legal.dpa" sections={SECTIONS} />;
}
