'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { RepSelector } from '@/components/sales/rep-selector';

interface CompanySummary {
  company: string;
  dealCount: number;
  clients: { name: string; dealCount: number }[];
}

const NOW = new Date();
const YEAR_OPTIONS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2];

export default function SummaryPage() {
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const [repId, setRepId] = useState<number | null>(null);
  const [data, setData] = useState<CompanySummary[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(() => {
    setLoading(true);
    setNotReady(false);
    const params = new URLSearchParams({ year: String(year) });
    if (repId) params.set('repId', String(repId));
    fetch(`/api/sales/summary?${params}`)
      .then(r => {
        if (r.status === 404) { setNotReady(true); return null; }
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(d => { if (d) setData(d.companies ?? []); })
      .catch(() => setNotReady(true))
      .finally(() => setLoading(false));
  }, [year, repId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggle(company: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(company) ? next.delete(company) : next.add(company);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Sales Summary</h1>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 cursor-pointer">
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <RepSelector selectedRepId={repId} onSelect={setRepId} />
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 animate-pulse">
              <div className="h-5 w-48 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && notReady && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Client and company referral summary coming soon.</p>
        </div>
      )}

      {!loading && !notReady && data && data.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-500">No summary data for {year}.</p>
        </div>
      )}

      {!loading && !notReady && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map(c => {
            const open = expanded.has(c.company);
            return (
              <div key={c.company} className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <button onClick={() => toggle(c.company)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{c.company}</span>
                    <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded">{c.dealCount}</span>
                  </div>
                  <svg className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {open && c.clients.length > 0 && (
                  <div className="border-t border-gray-100 px-5 pb-4">
                    {c.clients.map(cl => (
                      <div key={cl.name} className="flex items-center justify-between py-2 pl-4 text-sm">
                        <span className="text-gray-700">{cl.name}</span>
                        <span className="text-gray-500 tabular-nums">{cl.dealCount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
