'use client';

import { useCallback, useEffect, useState } from 'react';
import { RepSelector } from '@/components/sales/rep-selector';
import { OpeningsDrilldownModal } from '@/components/sales/openings-drilldown-modal';
import { RevenueDrilldownModal } from '@/components/sales/revenue-drilldown-modal';

interface MonthRow {
  month: number;
  monthName: string;
  openings: number;
  closings: number;
  revenue: number;
  ratio: number;
  trend: 'up' | 'down' | 'flat';
}

interface Drilldown { month: number; year: number; type: 'openings' | 'revenue' }

const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;
const YEAR_OPTIONS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2];

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ProductionHistoryPage() {
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const [repId, setRepId] = useState<number | null>(null);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: String(year) });
    if (repId) params.set('repId', String(repId));
    fetch(`/api/sales/production-history?${params}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => setMonths(d.months ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, repId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isCurrentYear = year === NOW.getFullYear();

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Production History</h1>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-900
                       focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] cursor-pointer">
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <RepSelector selectedRepId={repId} onSelect={setRepId} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load data</p>
          <button onClick={fetchData} className="mt-2 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">Retry</button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Month</th>
                  <th className="text-center px-3 py-3 font-medium text-gray-500 w-16">Trend</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Openings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Closings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Revenue</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Close %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-5 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                      ))}</tr>
                    ))
                  : months.length > 0
                    ? months.map(m => {
                        const isCurrent = isCurrentYear && m.month === CURRENT_MONTH;
                        const isFuture = isCurrentYear && m.month > CURRENT_MONTH;
                        return (
                          <tr key={m.month} className={`${isCurrent ? 'bg-blue-50' : ''} hover:bg-gray-50 transition-colors`}>
                            <td className="px-5 py-3 font-medium text-gray-900">{m.monthName}</td>
                            <td className="px-3 py-3 text-center">
                              {isFuture ? <span className="text-gray-300">—</span>
                                : m.trend === 'up' ? <span className="text-green-500">▲</span>
                                : m.trend === 'down' ? <span className="text-red-500">▼</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {isFuture ? <span className="text-gray-300">—</span> : (
                                <button onClick={() => setDrilldown({ month: m.month, year, type: 'openings' })}
                                  className="cursor-pointer text-blue-600 hover:underline tabular-nums">
                                  {m.openings}
                                </button>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                              {isFuture ? <span className="text-gray-300">—</span> : m.closings}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {isFuture ? <span className="text-gray-300">—</span> : (
                                <button onClick={() => setDrilldown({ month: m.month, year, type: 'revenue' })}
                                  className="cursor-pointer text-blue-600 hover:underline tabular-nums">
                                  {fmtCurrency(m.revenue)}
                                </button>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                              {isFuture ? <span className="text-gray-300">—</span> : `${Math.round(m.ratio)}%`}
                            </td>
                          </tr>
                        );
                      })
                    : null}
              </tbody>
            </table>
            {!loading && months.length === 0 && (
              <div className="p-12 text-center"><p className="text-gray-500">No production data available for {year}.</p></div>
            )}
          </div>
        </div>
      )}

      {/* Drilldown Modals */}
      {drilldown?.type === 'openings' && (
        <OpeningsDrilldownModal
          isOpen
          month={drilldown.month}
          year={drilldown.year}
          repId={repId}
          onClose={() => setDrilldown(null)}
        />
      )}
      {drilldown?.type === 'revenue' && (
        <RevenueDrilldownModal
          isOpen
          month={drilldown.month}
          year={drilldown.year}
          repId={repId}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
