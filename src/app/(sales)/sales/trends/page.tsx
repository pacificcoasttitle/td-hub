'use client';

import { useCallback, useEffect, useState } from 'react';
import { RepSelector } from '@/components/sales/rep-selector';
import { TrendChart } from '@/components/sales/trend-chart';
import type { DataPoint } from '@/components/sales/trend-chart';

interface TrendMonth { month: number; openings: number; closings: number; revenue: number }
interface TrendYear { year: number; months: TrendMonth[] }
interface TrendsData { currentYear: TrendYear; priorYear: TrendYear }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toPoints(months: TrendMonth[], key: 'openings' | 'closings' | 'revenue'): DataPoint[] {
  return months.map(m => ({ month: MONTH_ABBR[m.month - 1] ?? `M${m.month}`, value: m[key] }));
}

export default function TrendsPage() {
  const [repId, setRepId] = useState<number | null>(null);
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = repId ? `?repId=${repId}` : '';
    fetch(`/api/sales/trends${params}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [repId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const curLabel = data ? String(data.currentYear.year) : String(new Date().getFullYear());
  const priorLabel = data ? String(data.priorYear.year) : String(new Date().getFullYear() - 1);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Trends</h1>
        <RepSelector selectedRepId={repId} onSelect={setRepId} />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load trends</p>
          <button onClick={fetchData} className="mt-2 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">Retry</button>
        </div>
      )}

      {/* Charts */}
      {loading ? (
        <div className="space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="h-5 w-36 bg-gray-200 rounded animate-pulse mb-3" />
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
                <div className="h-[300px] bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : data && !error ? (
        <div className="space-y-8">
          <TrendChart
            title="Title Openings"
            currentYearData={toPoints(data.currentYear.months, 'openings')}
            priorYearData={toPoints(data.priorYear.months, 'openings')}
            valueFormat="number"
            currentYearLabel={curLabel}
            priorYearLabel={priorLabel}
          />
          <TrendChart
            title="Title Closings"
            currentYearData={toPoints(data.currentYear.months, 'closings')}
            priorYearData={toPoints(data.priorYear.months, 'closings')}
            valueFormat="number"
            currentYearLabel={curLabel}
            priorYearLabel={priorLabel}
          />
          <TrendChart
            title="Title Revenue"
            currentYearData={toPoints(data.currentYear.months, 'revenue')}
            priorYearData={toPoints(data.priorYear.months, 'revenue')}
            valueFormat="currency"
            currentYearLabel={curLabel}
            priorYearLabel={priorLabel}
          />
        </div>
      ) : null}
    </div>
  );
}
