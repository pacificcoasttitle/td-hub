'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/components/shared/activity-feed';
import { StatCard, VendorCards, type LogStats } from './vendor-logs/stats-panel';
import { ApiFilterBar, DocFilterBar } from './vendor-logs/filter-bar';
import { ApiLogRow, type LogRow } from './vendor-logs/log-row';

type SubTab = 'api' | 'documents';

interface DocRow {
  id: number;
  action: string;
  documentName: string;
  orderId: number | null;
  fileNumber: string | null;
  actor: string | null;
  timestamp: string;
}

export function VendorLogsTab() {
  const [subTab, setSubTab] = useState<SubTab>('api');
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
      <div className="flex items-center gap-3">
        <StatCard label="Total Today" value={stats?.totalToday} loading={statsLoading} />
        <StatCard label="Success" value={stats?.successCount} loading={statsLoading} color="text-green-600" />
        <StatCard label="Errors" value={stats?.errorCount} loading={statsLoading} color="text-red-600" />
        <StatCard label="Avg Response" value={stats ? `${stats.avgResponseMs}ms` : undefined} loading={statsLoading} />
        <button onClick={fetchStats} disabled={statsLoading} title="Refresh stats"
          className="ml-auto p-2 text-[#6B7280] hover:text-[#1A1A2E] hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
          <svg className={`h-4 w-4 ${statsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
      </div>

      <VendorCards stats={stats} subTab={subTab} />

      <div className="flex gap-4 border-b border-gray-200">
        <button onClick={() => setSubTab('api')}
          className={`pb-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${subTab === 'api' ? 'border-[#1B2A4A] text-[#1A1A2E]' : 'border-transparent text-[#6B7280] hover:text-[#1A1A2E]'}`}>
          API Calls
        </button>
        <button onClick={() => setSubTab('documents')}
          className={`pb-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${subTab === 'documents' ? 'border-[#1B2A4A] text-[#1A1A2E]' : 'border-transparent text-[#6B7280] hover:text-[#1A1A2E]'}`}>
          Document Activity
        </button>
      </div>

      {subTab === 'api' && <ApiLogsSection />}
      {subTab === 'documents' && <DocActivitySection />}
    </div>
  );
}

function ApiLogsSection() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [vendor, setVendor] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const cursorRef = useRef<number | null>(null);

  const fetchLogs = useCallback((append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    const params = new URLSearchParams({ pageSize: '25' });
    if (vendor) params.set('vendor', vendor);
    if (statusFilter !== 'all') params.set('success', statusFilter === 'success' ? 'true' : 'false');
    if (append && cursorRef.current) params.set('before_id', String(cursorRef.current));
    fetch(`/api/logs?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const rows: LogRow[] = d.logs ?? [];
        setHasMore(d.hasMore ?? rows.length === 25);
        if (rows.length > 0) cursorRef.current = rows[rows.length - 1].id;
        setLogs((prev) => append ? [...prev, ...rows] : rows);
      })
      .catch(() => {})
      .finally(() => { if (append) setLoadingMore(false); else setLoading(false); });
  }, [vendor, statusFilter]);

  useEffect(() => { cursorRef.current = null; fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) { cursorRef.current = null; fetchLogs(); } }, 60_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <ApiFilterBar vendor={vendor} onVendorChange={setVendor} statusFilter={statusFilter} onStatusChange={setStatusFilter} />
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
      {hasMore && !loading && (
        <div className="px-4 py-3 border-t border-gray-100 text-center">
          <button onClick={() => fetchLogs(true)} disabled={loadingMore}
            className="text-sm font-medium text-[#C5A55A] hover:text-[#B8953D] disabled:opacity-50 transition-colors">
            {loadingMore ? 'Loading…' : 'Load older →'}
          </button>
        </div>
      )}
    </div>
  );
}

function DocActivitySection() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const cursorRef = useRef<number | null>(null);

  const fetchDocs = useCallback((append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    const params = new URLSearchParams({ pageSize: '25' });
    if (actionFilter) params.set('action', actionFilter);
    if (append && cursorRef.current) params.set('before_id', String(cursorRef.current));
    fetch(`/api/logs/documents?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const items: DocRow[] = d.logs ?? d.documents ?? [];
        setHasMore(d.hasMore ?? items.length === 25);
        if (items.length > 0) cursorRef.current = items[items.length - 1].id;
        setRows((prev) => append ? [...prev, ...items] : items);
      })
      .catch(() => {})
      .finally(() => { if (append) setLoadingMore(false); else setLoading(false); });
  }, [actionFilter]);

  useEffect(() => { cursorRef.current = null; fetchDocs(); }, [fetchDocs]);
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) { cursorRef.current = null; fetchDocs(); } }, 60_000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <DocFilterBar actionFilter={actionFilter} onActionChange={setActionFilter} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Time</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Action</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">Document</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">File #</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#6B7280] text-xs uppercase tracking-wide">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded" style={{ width: `${40 + Math.random() * 40}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-[#6B7280]">No document activity found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{timeAgo(r.timestamp)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                    r.action === 'upload' ? 'bg-blue-50 text-blue-700'
                    : r.action === 'generate' ? 'bg-green-50 text-green-700'
                    : r.action === 'delete' ? 'bg-red-50 text-red-700'
                    : 'bg-gray-100 text-[#4B5563]'
                  }`}>{r.action}</span>
                </td>
                <td className="px-4 py-3 text-[#1A1A2E] max-w-[240px] truncate">{r.documentName}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.orderId ? (
                    <Link href={`/orders/${r.orderId}`} className="text-[#C5A55A] hover:underline font-medium text-xs font-mono">
                      {r.fileNumber ?? `#${r.orderId}`}
                    </Link>
                  ) : <span className="text-[#9CA3AF]">—</span>}
                </td>
                <td className="px-4 py-3 text-[#6B7280]">{r.actor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && !loading && (
        <div className="px-4 py-3 border-t border-gray-100 text-center">
          <button onClick={() => fetchDocs(true)} disabled={loadingMore}
            className="text-sm font-medium text-[#C5A55A] hover:text-[#B8953D] disabled:opacity-50 transition-colors">
            {loadingMore ? 'Loading…' : 'Load older →'}
          </button>
        </div>
      )}
    </div>
  );
}
