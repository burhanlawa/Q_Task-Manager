'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { ReportsToolbar, type RangePreset } from '../_shared';

type Bucket = { date: string; total: number; completed: number };
type Response = { range: RangePreset; from: string; to: string; buckets: Bucket[] };

export function TasksCompletionChart() {
  const t = useTranslations('reports');
  const tc = useTranslations('reports.tasksCompletion');
  const [range, setRange] = useState<RangePreset>('30d');

  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ['reports', 'tasks-completion', range],
    queryFn: () => api.get(`reports/tasks-completion?range=${range}`),
  });

  return (
    <div className="space-y-4">
      <ReportsToolbar
        range={range}
        onRangeChange={setRange}
        csvHref={`/api/proxy/reports/tasks-completion/export?range=${range}`}
      />

      <div className="rounded-lg border bg-card p-4">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : error || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loadError')}
          </p>
        ) : data.buckets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.empty')}
          </p>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.buckets}
                margin={{ top: 16, right: 16, bottom: 8, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total"     name={tc('axisCreated')}   fill="#94a3b8" />
                <Bar dataKey="completed" name={tc('axisCompleted')} fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
