'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { StatsRow, VendorCards, type LogStats } from './vendor-logs/stats-panel';
import { ApiFilterBar } from './vendor-logs/filter-bar';
import { ApiLogRow, type LogRow } from './vendor-logs/log-row';

// ─── Vendor logs ─────────────────────────────────────────────────────────────
//
// There used to be a second tab here, "Document Activity". It fetched
// /api/logs/documents, an endpoint nobody ever wrote; the 404 was swallowed by
// `if (!d) return`, so admins saw an empty table that read as "no documents".
// Removed 2026-09-21 rather than left lying. If document logs are wanted, they
// get built properly — endpoint first.

const PAGE_SIZE = 50;

export function VendorLogsTab() {
  const [stats, setStats] = useState<LogStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchStats = useCallback(() => {
    setStatsLoading(true);
    fetch('/api/logs/stats')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <div className="space-y-5">
      <StatsRow stats={stats} loading={statsLoading} onRefresh={fetchStats} />

      <VendorCards stats={stats} />

      <ApiLogsSection />
    </div>
  );
}

function ApiLogsSection() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vendor, setVendor] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleSearchChange(v: string) {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setCommittedSearch(v); setPage(1); }, 500);
  }

  const fetchLogs = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (vendor) params.set('vendor', vendor);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (committedSearch) params.set('search', committedSearch);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    fetch(`/api/admin/job-log?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load job log (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setLogs(d.logs ?? []);
        setTotal(Number(d.total ?? 0));
      })
      .catch((err) => { if (err?.name !== 'AbortError') setError(err.message ?? 'Failed to load job log'); })
      .finally(() => setLoading(false));
  }, [page, vendor, statusFilter, committedSearch, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) fetchLogs(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => { setPage(1); }, [vendor, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showStart = total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <ApiFilterBar
        vendor={vendor} onVendorChange={setVendor}
        statusFilter={statusFilter} onStatusChange={setStatusFilter}
        search={search} onSearchChange={handleSearchChange} onSearchSubmit={() => { setCommittedSearch(search); setPage(1); }}
        dateFrom={dateFrom} onDateFromChange={setDateFrom}
        dateTo={dateTo} onDateToChange={setDateTo}
      />
      {error ? (
        <div className="p-8 text-center">
          <p className="text-red-600 font-medium">Failed to load job log</p>
          <p className="text-sm text-[#6B7280] mt-1">{error}</p>
          <button onClick={fetchLogs} className="mt-3 text-sm font-medium text-[#C5A55A] hover:text-[#B8953D]">Retry</button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Vendor</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Endpoint</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">File #</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded" style={{ width: `${40 + Math.random() * 40}%` }} /></td>
                      ))}
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-[#6B7280]">No logs found. Try adjusting your filters.</td></tr>
                ) : logs.map((log) => (
                  <ApiLogRow key={log.id} log={log} expanded={expandedId === log.id}
                    onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)} />
                ))}
              </tbody>
            </table>
          </div>
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
              <p className="text-sm text-[#6B7280]">
                Showing <span className="font-medium text-[#1A1A2E]">{showStart}</span>–<span className="font-medium text-[#1A1A2E]">{showEnd}</span> of <span className="font-medium text-[#1A1A2E]">{total}</span>
              </p>
              <div className="flex items-center gap-1">
                <PagBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</PagBtn>
                <PagBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next ›</PagBtn>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PagBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-[#1A1A2E] hover:bg-gray-100'}`}>
      {children}
    </button>
  );
}
