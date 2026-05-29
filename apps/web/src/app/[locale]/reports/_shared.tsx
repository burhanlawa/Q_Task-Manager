'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// 7d/30d/90d preset only — custom date ranges are Phase 2 per blueprint v2.0.
export const RANGE_VALUES = ['7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_VALUES)[number];

// Reusable range picker + export-csv button row. Each report page renders
// the same toolbar — keeping the markup here makes it trivial to add new
// reports without copy-pasting the chrome.
export function ReportsToolbar({
  range,
  onRangeChange,
  csvHref,
}: {
  range: RangePreset;
  onRangeChange: (next: RangePreset) => void;
  // Path to download the CSV from. We always render the button as an
  // <a download> so the browser handles the stream natively — fetch+blob
  // would defeat the server-side streaming we built in 18.4.
  csvHref: string;
}) {
  const t = useTranslations('reports.common');
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="report-range">{t('rangeLabel')}</Label>
        <Select value={range} onValueChange={(v) => onRangeChange(v as RangePreset)}>
          <SelectTrigger id="report-range" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_VALUES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`ranges.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button asChild variant="outline">
        <a href={csvHref} download>
          {t('exportCsv')}
        </a>
      </Button>
    </div>
  );
}

// Same toolbar minus the range — workload distribution is "right now"
// and doesn't take a range param.
export function WorkloadToolbar({ csvHref }: { csvHref: string }) {
  const t = useTranslations('reports.common');
  return (
    <div className="flex flex-wrap items-end justify-end gap-3 rounded-lg border bg-card p-4">
      <Button asChild variant="outline">
        <a href={csvHref} download>
          {t('exportCsv')}
        </a>
      </Button>
    </div>
  );
}
