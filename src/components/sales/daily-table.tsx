'use client';

import { useEffect, useState } from 'react';
import type { DailyData } from './types';

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const NOW = new Date();
const MONTH_LABEL = `${NOW.toLocaleString('en-US', { month: 'long' })} ${NOW.getFullYear()}`;

export function DailyTable() {
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sales/daily')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Daily Team Summary</h1>
        <p className="text-sm text-gray-500">{MONTH_LABEL}</p>
      </div>

      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-red-600 font-medium">Failed to load daily summary</p>
          <p className="text-sm text-gray-500 mt-1">Error: {error}</p>
        </div>
      )}

      {!error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-5 py-3 font-medium text-gray-500 w-12">#</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Sales Rep</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Openings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Closings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }).map((__, j) => (
                          <td key={j} className="px-5 py-3">
                            <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : data?.reps.map((r, i) => (
                      <tr key={r.name} className={`${i % 2 === 1 ? 'bg-gray-50' : ''} hover:bg-gray-100 transition-colors`}>
                        <td className="px-5 py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-5 py-3 text-right text-gray-700 tabular-nums">{r.openings}</td>
                        <td className="px-5 py-3 text-right text-gray-700 tabular-nums">{r.closings}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900 tabular-nums">{fmtCurrency(r.revenue)}</td>
                      </tr>
                    ))}
              </tbody>

              {/* Totals row */}
              {!loading && data && data.reps.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3 text-gray-900">TOTALS</td>
                    <td className="px-5 py-3 text-right text-gray-900 tabular-nums">{data.totals.openings}</td>
                    <td className="px-5 py-3 text-right text-gray-900 tabular-nums">{data.totals.closings}</td>
                    <td className="px-5 py-3 text-right text-gray-900 tabular-nums">{fmtCurrency(data.totals.revenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>

            {!loading && (!data?.reps || data.reps.length === 0) && (
              <div className="p-12 text-center">
                <p className="text-gray-500 font-medium">No team data available for this month</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
