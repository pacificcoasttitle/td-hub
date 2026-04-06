'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';

interface CommissionMonth {
  month: number;
  monthName: string;
  commission: number;
  pdfFilename: string | null;
  pdfUrl: string | null;
  breakdown: Record<string, number> | null;
}

const NOW = new Date();
const YEAR_OPTIONS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2];

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

export default function CommissionPage() {
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const [data, setData] = useState<CommissionMonth[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setNotReady(false);
    fetch(`/api/sales/commission?year=${year}`)
      .then(r => {
        if (r.status === 404) { setNotReady(true); return null; }
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(d => { if (d) setData(d.months ?? []); })
      .catch(() => setNotReady(true))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Commission History</h1>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 cursor-pointer">
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-gray-100 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {!loading && notReady && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <DollarSign className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Commission details coming soon.</p>
          <p className="text-sm text-gray-400 mt-1">Monthly statements with full breakdowns will appear here.</p>
        </div>
      )}

      {!loading && !notReady && data && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Month</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Commission</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">PDF</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500 w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(m => {
                const isFuture = year === NOW.getFullYear() && m.month > NOW.getMonth() + 1;
                const isOpen = expanded === m.month;
                return (
                  <Fragment key={m.month}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900">{m.monthName}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                        {isFuture ? <span className="text-gray-300">—</span> : fmtCurrency(m.commission)}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{m.pdfFilename ?? '—'}</td>
                      <td className="px-5 py-3 text-right">
                        {!isFuture && m.breakdown && (
                          <button onClick={() => setExpanded(isOpen ? null : m.month)}
                            className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A]">
                            {isOpen ? 'Hide' : 'View'}
                          </button>
                        )}
                        {m.pdfUrl && (
                          <a href={m.pdfUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-600 hover:underline ml-3">
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                    {isOpen && m.breakdown && (
                      <tr>
                        <td colSpan={4} className="bg-gray-50 px-8 py-4">
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm max-w-md">
                            {Object.entries(m.breakdown).map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between">
                                <span className="text-gray-600 capitalize">{k.replace(/_/g, ' ')}</span>
                                <span className="text-gray-900 font-medium tabular-nums">{fmtCurrency(v)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data.length === 0 && (
            <div className="p-12 text-center"><p className="text-gray-500">No commission data for {year}.</p></div>
          )}
        </div>
      )}
    </div>
  );
}
