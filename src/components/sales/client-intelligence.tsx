'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '@/components/admin/dashboards/shared';
import { RepSelector } from './rep-selector';
import { Sparkline } from './sparkline';

interface ClientEntry {
  clientName: string;
  companyName: string;
  deals: number;
  revenue: number;
  lastCloseDate: string;
  firstDealDate: string;
  isNewThisYear: boolean;
  monthlyDeals: number[];
}

interface Totals {
  totalClients: number;
  repeatClients: number;
  newClients: number;
  topClientRevenue: number;
  avgDealsPerClient: number;
  totalRevenue: number;
  totalDeals: number;
}

interface SummaryData { year: number; totals: Totals; clients: ClientEntry[] }

interface Props { role: 'sales_rep' | 'sales_manager' }

const NOW = new Date();
const YEAR_OPTIONS = [NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2];

type SortBy = 'revenue' | 'deals';

function fmtShortDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function daysSince(iso: string): number {
  if (!iso) return 9999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function ClientIntelligence({ role }: Props) {
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const [repId, setRepId] = useState<number | null>(null);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('revenue');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: String(year) });
    if (repId) params.set('repId', String(repId));
    fetch(`/api/sales/summary?${params}`)
      .then(r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, repId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sorted = useMemo(() => {
    if (!data?.clients) return [];
    return [...data.clients].sort((a, b) => {
      if (sortBy === 'revenue') return b.revenue - a.revenue;
      return b.deals - a.deals || b.revenue - a.revenue;
    });
  }, [data, sortBy]);

  const inactive = useMemo(() => {
    if (!data?.clients) return [];
    return data.clients
      .filter(c => daysSince(c.lastCloseDate) >= 90)
      .sort((a, b) => daysSince(b.lastCloseDate) - daysSince(a.lastCloseDate))
      .slice(0, 5);
  }, [data]);

  const newClients = useMemo(() => {
    if (!data?.clients) return [];
    return data.clients
      .filter(c => c.isNewThisYear)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [data]);

  const t = data?.totals;
  const repeatPct = t && t.totalClients > 0
    ? Math.round((t.repeatClients / t.totalClients) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">Client intelligence</h1>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 cursor-pointer">
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {role === 'sales_manager' && (
            <RepSelector selectedRepId={repId} onSelect={setRepId} />
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load data</p>
          <button onClick={fetchData}
            className="mt-3 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">Retry</button>
        </div>
      )}

      {/* 404 / null → graceful placeholder */}
      {!loading && !error && !data && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-500 font-medium">Client intelligence data is being prepared.</p>
          <p className="text-xs text-gray-400 mt-1">Check back soon.</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && <Skeleton />}

      {/* Main content */}
      {!loading && !error && data && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Metric label="Total clients" value={String(t?.totalClients ?? 0)} />
            <Metric label="Repeat clients" value={String(t?.repeatClients ?? 0)} sub={`(${repeatPct}%)`} />
            <Metric label="Top client revenue" value={formatCurrency(t?.topClientRevenue ?? 0)} />
            <Metric label="Avg deals per client" value={(t?.avgDealsPerClient ?? 0).toFixed(1)} />
          </div>

          {/* Top producing clients */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">Top producing clients</span>
              <div className="flex gap-1">
                <Pill active={sortBy === 'revenue'} onClick={() => setSortBy('revenue')}>By revenue</Pill>
                <Pill active={sortBy === 'deals'} onClick={() => setSortBy('deals')}>By deals</Pill>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                No client data available for {year}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/60 border-b border-gray-100">
                      <th className="text-left pl-5 pr-2 py-2 font-medium text-gray-400 w-8">#</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Client / company</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500">Deals</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500">Trend</th>
                      <th className="text-center px-3 pr-5 py-2 font-medium text-gray-500">Last close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c, i) => (
                      <tr key={`${c.clientName}-${c.companyName}`}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="pl-5 pr-2 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium text-gray-900">{c.clientName}</p>
                          <p className="text-xs text-gray-500">{c.companyName}</p>
                        </td>
                        <td className="text-center px-3 py-3 font-semibold text-gray-900 tabular-nums">{c.deals}</td>
                        <td className="text-right px-3 py-3 font-semibold text-gray-900 tabular-nums">{formatCurrency(c.revenue)}</td>
                        <td className="text-center px-3 py-3">
                          <Sparkline data={c.monthlyDeals} />
                        </td>
                        <td className="text-center px-3 pr-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {fmtShortDate(c.lastCloseDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bottom cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <InactiveCard clients={inactive} />
            <NewClientsCard clients={newClients} year={year} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">
        {value}
        {sub && <span className="text-sm font-normal text-gray-400 ml-1">{sub}</span>}
      </p>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full transition-colors ${
        active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 cursor-pointer hover:bg-gray-200'
      }`}>{children}</button>
  );
}

function InactiveCard({ clients }: { clients: ClientEntry[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-900">Inactive clients</p>
      <p className="text-xs text-gray-500 mb-3">No closed deals in 90+ days</p>
      {clients.length === 0 ? (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          All clients active — great job!
        </p>
      ) : (
        <div className="space-y-2.5">
          {clients.map(c => {
            const days = daysSince(c.lastCloseDate);
            return (
              <div key={`${c.clientName}-${c.companyName}`} className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.clientName}</p>
                  <p className="text-xs text-gray-500 truncate">{c.companyName}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-xs text-red-500 font-medium">{days} days</p>
                  <p className="text-xs text-gray-400">{c.deals} deal{c.deals !== 1 ? 's' : ''} this year</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewClientsCard({ clients, year }: { clients: ClientEntry[]; year: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-900">New clients this year</p>
      <p className="text-xs text-gray-500 mb-3">First deal in {year}</p>
      {clients.length === 0 ? (
        <p className="text-xs text-gray-400">No new clients yet this year</p>
      ) : (
        <div className="space-y-2.5">
          {clients.map(c => (
            <div key={`${c.clientName}-${c.companyName}`} className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{c.clientName}</p>
                <p className="text-xs text-gray-500 truncate">{c.companyName}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-xs text-green-600 font-medium">{c.deals} deal{c.deals !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-500">{formatCurrency(c.revenue)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-200 rounded" />
            <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6 animate-pulse">
        <div className="px-5 py-3 border-b border-gray-100"><div className="h-4 w-40 bg-gray-200 rounded" /></div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-gray-100">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="flex-1"><div className="h-4 w-32 bg-gray-200 rounded" /></div>
            <div className="h-4 w-10 bg-gray-200 rounded" />
            <div className="h-4 w-16 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
            <div className="h-4 w-28 bg-gray-200 rounded mb-3" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-4 w-full bg-gray-200 rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
