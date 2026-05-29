'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { WorkloadToolbar } from '../_shared';

type Row = {
  userId: string;
  displayName: string | null;
  email: string;
  openCount: number;
  byPriority: { low: number; medium: number; high: number; urgent: number };
  weightedLoad: number;
};
type Response = { rows: Row[] };

export function WorkloadChart() {
  const t = useTranslations('reports');
  const tw = useTranslations('reports.workload');

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['reports', 'workload-distribution'],
    queryFn: () => api.get('reports/workload-distribution'),
  });

  // Recharts horizontal-bar requires a "label" column and a numeric. We
  // collapse displayName-or-email into a single short label and cap to
  // 20 rows so the chart stays readable on a phone.
  const chartData =
    data?.rows.slice(0, 20).map((row) => ({
      label: row.displayName ?? row.email,
      load: row.weightedLoad,
      // Hover tooltip carries the open count + priority breakdown.
      openCount: row.openCount,
      low: row.byPriority.low,
      medium: row.byPriority.medium,
      high: row.byPriority.high,
      urgent: row.byPriority.urgent,
    })) ?? [];

  return (
    <div className="space-y-4">
      <WorkloadToolbar csvHref="/api/proxy/reports/workload-distribution/export" />

      <div className="rounded-lg border bg-card p-4">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : error || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loadError')}
          </p>
        ) : chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.empty')}
          </p>
        ) : (
          <div className="h-[28rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 16, right: 24, bottom: 8, left: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  width={140}
                />
                <Tooltip />
                <Bar dataKey="load" name={tw('axisLoad')} fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
