'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ReportsToolbar, type RangePreset } from '../_shared';

type Row = {
  userId: string;
  displayName: string | null;
  email: string;
  assigned: number;
  completed: number;
  onTimePct: number | null;
  avgRevisions: number;
};
type Response = { range: RangePreset; from: string; to: string; rows: Row[] };

export function EmployeePerformanceTable() {
  const t = useTranslations('reports');
  const tep = useTranslations('reports.employeePerformance');
  const [range, setRange] = useState<RangePreset>('30d');

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['reports', 'employee-performance', range],
    queryFn: () => api.get(`reports/employee-performance?range=${range}`),
  });

  return (
    <div className="space-y-4">
      <ReportsToolbar
        range={range}
        onRangeChange={setRange}
        csvHref={`/api/proxy/reports/employee-performance/export?range=${range}`}
      />

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : error || !data ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('common.loadError')}
          </p>
        ) : data.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('common.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{tep('cols.name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{tep('cols.email')}</th>
                  <th className="px-4 py-2 text-end font-medium">{tep('cols.assigned')}</th>
                  <th className="px-4 py-2 text-end font-medium">{tep('cols.completed')}</th>
                  <th className="px-4 py-2 text-end font-medium">{tep('cols.onTimePct')}</th>
                  <th className="px-4 py-2 text-end font-medium">{tep('cols.avgRevisions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.userId} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      {row.displayName ?? row.email}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.email}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{row.assigned}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{row.completed}</td>
                    <td className="px-4 py-2 text-end tabular-nums">
                      {row.onTimePct === null ? tep('onTimeNone') : `${row.onTimePct}%`}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums">{row.avgRevisions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
