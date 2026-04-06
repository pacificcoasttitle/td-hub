'use client';

import { useCallback, useEffect, useState } from 'react';

interface RankedRep {
  rank: number;
  name: string;
  openings: number;
  closings: number;
  revenue: number;
  ratio: number;
}

const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;
const YEAR_OPTIONS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

const RANK_COLORS: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800',
  2: 'bg-gray-100 text-gray-700',
  3: 'bg-orange-100 text-orange-800',
};

export function RankingContent() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const [reps, setReps] = useState<RankedRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/sales/ranking?month=${month}&year=${year}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => setReps(d.reps ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Sales Ranking</h1>
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 cursor-pointer">
            {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 cursor-pointer">
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-red-600 font-medium">Failed to load ranking</p>
          <button onClick={fetchData} className="mt-2 text-sm font-medium text-[#F26B2B]">Retry</button>
        </div>
      )}

      {!error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-5 py-3 font-medium text-gray-500 w-16">Rank</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Sales Rep</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Openings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Closings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Revenue</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Close %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-5 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                      ))}</tr>
                    ))
                  : reps.map(r => (
                      <tr key={r.rank} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${RANK_COLORS[r.rank] ?? 'bg-white text-gray-600'}`}>
                            {r.rank}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-5 py-3 text-right text-gray-700 tabular-nums">{r.openings}</td>
                        <td className="px-5 py-3 text-right text-gray-700 tabular-nums">{r.closings}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900 tabular-nums">{fmtCurrency(r.revenue)}</td>
                        <td className="px-5 py-3 text-right text-gray-700 tabular-nums">{r.ratio}%</td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && reps.length === 0 && (
              <div className="p-12 text-center"><p className="text-gray-500">No ranking data for {MONTH_NAMES[month - 1]} {year}.</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
