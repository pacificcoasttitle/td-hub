'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';

export interface DataPoint { month: string; value: number }

interface Props {
  title: string;
  currentYearData: DataPoint[];
  priorYearData: DataPoint[];
  valueFormat: 'number' | 'currency';
  currentYearLabel: string;
  priorYearLabel: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function fmtValue(n: number, format: 'number' | 'currency'): string {
  if (format === 'currency') return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  return n.toLocaleString();
}

function buildMerged(current: DataPoint[], prior: DataPoint[]): Record<string, unknown>[] {
  const map = new Map<string, { current: number | null; prior: number | null }>();
  for (const m of MONTHS) map.set(m, { current: null, prior: null });
  for (const d of current) map.set(d.month, { ...map.get(d.month)!, current: d.value });
  for (const d of prior) map.set(d.month, { ...map.get(d.month)!, prior: d.value });
  return MONTHS.map(m => ({ month: m, current: map.get(m)?.current ?? null, prior: map.get(m)?.prior ?? null }));
}

export function TrendChart({ title, currentYearData, priorYearData, valueFormat, currentYearLabel, priorYearLabel }: Props) {
  const merged = buildMerged(currentYearData, priorYearData);
  const hasData = currentYearData.length > 0 || priorYearData.length > 0;

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        {!hasData ? (
          <div className="flex items-center justify-center h-[300px] text-gray-500 text-sm">
            No trend data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={merged} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 12, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => valueFormat === 'currency' ? fmtCurrency(v as number) : String(v)}
                width={60}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13 }}
                formatter={(v) => fmtValue(Number(v ?? 0), valueFormat)}
              />
              <Legend
                verticalAlign="bottom"
                iconType="line"
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
              />
              <Line
                type="monotone"
                dataKey="current"
                name={currentYearLabel}
                stroke="#F26B2B"
                strokeWidth={2}
                dot={{ r: 4, fill: '#F26B2B' }}
                activeDot={{ r: 6 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="prior"
                name={priorYearLabel}
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#94A3B8' }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
