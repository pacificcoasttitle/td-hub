'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/components/shared/activity-feed';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface LogStats {
  totalToday: number;
  successCount: number;
  errorCount: number;
  avgResponseMs: number;
  byVendor: Record<string, { count: number; successPct: number }>;
}

interface LogRow {
  id: number;
  vendor: string;
  operation: string;
  orderId: number | null;
  fileNumber: string | null;
  startedAt: string;
  endedAt: string | null;
  success: boolean | null;
  httpStatus: number | null;
  errorMessage: string | null;
  requestUrl: string | null;
}

interface LogDetail {
  requestMeta: unknown;
  responseMeta: unknown;
  requestId: string | null;
  errorCategory: string | null;
}

interface DocRow {
  id: number;
  action: string;
  documentName: string;
  orderId: number | null;
  fileNumber: string | null;
  actor: string | null;
  timestamp: string;
}

type SubTab = 'api' | 'documents';

const VENDORS = ['SoftPro', 'SiteX', 'TitlePoint', 'Westcor', 'FNF', 'SendGrid', 'Twilio'] as const;
const VENDOR_KEYS = VENDORS.map((v) => v.toLowerCase());

/* ── Main Component ────────────────────────────────────────────────────────── */

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
      {/* Stats Header */}
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

      {/* Vendor Filter Cards */}
      <VendorCards stats={stats} subTab={subTab} />

      {/* Sub-tabs */}
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

/* ── Vendor Cards ──────────────────────────────────────────────────────────── */

function VendorCards({ stats, subTab }: { stats: LogStats | null; subTab: SubTab }) {
  if (subTab !== 'api') return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {VENDORS.map((v) => {
        const key = v.toLowerCase();
        const data = stats?.byVendor?.[key];
        return (
          <div key={v} className="shrink-0 px-3 py-2 bg-white border border-gray-200 rounded-lg text-center min-w-[90px]">
            <p className="text-xs font-semibold text-[#1A1A2E]">{v}</p>
            <p className="text-lg font-bold text-[#1A1A2E] tabular-nums">{data?.count ?? 0}</p>
            {data && data.count > 0 && (
              <p className={`text-[10px] font-medium ${data.successPct >= 90 ? 'text-green-600' : data.successPct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                {data.successPct.toFixed(0)}% ok
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── API Logs Section ──────────────────────────────────────────────────────── */

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
    const interval = setInterval(() => {
      if (!document.hidden) { cursorRef.current = null; fetchLogs(); }
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}
          className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A]">
          <option value="">All Vendors</option>
          {VENDORS.map((v) => <option key={v} value={v.toLowerCase()}>{v}</option>)}
        </select>
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
          {(['all', 'success', 'error'] as const).map((opt) => (
            <button key={opt} onClick={() => setStatusFilter(opt)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === opt ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
              {opt === 'all' ? 'All' : opt === 'success' ? 'Success' : 'Error'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[#9CA3AF]">Auto-refreshes every 60s</span>
      </div>

      {/* Table */}
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

      {/* Load More */}
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

/* ── Single API Log Row (expandable + lazy detail) ─────────────────────────── */

function ApiLogRow({ log, expanded, onToggle }: { log: LogRow; expanded: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const durationMs = log.startedAt && log.endedAt
    ? Math.round(new Date(log.endedAt).getTime() - new Date(log.startedAt).getTime())
    : null;

  function loadDetail() {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    fetch(`/api/logs/${log.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setDetail(d); })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }

  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{timeAgo(log.startedAt)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="inline-flex px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-[#1A1A2E] capitalize">{log.vendor}</span>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[#1A1A2E] max-w-[240px] truncate">{log.operation}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.orderId ? (
            <Link href={`/orders/${log.orderId}`} onClick={(e) => e.stopPropagation()} className="text-[#C5A55A] hover:underline font-medium text-xs font-mono">
              {log.fileNumber ?? `#${log.orderId}`}
            </Link>
          ) : <span className="text-[#9CA3AF]">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.success === true && <span className="text-green-600 font-medium text-xs">✓</span>}
          {log.success === false && <span className="text-red-600 font-medium text-xs">✗</span>}
          {log.success === null && <span className="text-[#9CA3AF] text-xs">—</span>}
        </td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap tabular-nums text-xs">
          {durationMs !== null ? `${durationMs}ms` : '—'}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-2 text-xs">
              {log.requestUrl && (
                <div><span className="font-semibold text-[#6B7280] uppercase tracking-wider">URL</span><p className="font-mono text-[#1A1A2E] mt-0.5 break-all">{log.requestUrl}</p></div>
              )}
              {log.httpStatus && (
                <div><span className="font-semibold text-[#6B7280] uppercase tracking-wider">HTTP</span> <span className={`font-mono ${(log.httpStatus ?? 0) >= 400 ? 'text-red-600' : 'text-[#1A1A2E]'}`}>{log.httpStatus}</span></div>
              )}
              {log.errorMessage && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-red-700">{log.errorMessage}</div>
              )}

              {/* Lazy-load full detail */}
              {!detail && !detailLoading && (
                <button onClick={(e) => { e.stopPropagation(); loadDetail(); }}
                  className="text-[#C5A55A] hover:text-[#B8953D] font-medium mt-1">
                  Show Full Details
                </button>
              )}
              {detailLoading && (
                <div className="flex items-center gap-2 text-[#6B7280]">
                  <div className="w-3 h-3 border border-gray-300 border-t-[#C5A55A] rounded-full animate-spin" />
                  Loading details…
                </div>
              )}
              {detail && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                  <div>
                    <p className="font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Request</p>
                    <JsonBlock data={detail.requestMeta} />
                  </div>
                  <div>
                    <p className="font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Response</p>
                    <JsonBlock data={detail.responseMeta} />
                  </div>
                  {detail.errorCategory && <p className="text-red-600 font-medium lg:col-span-2">Category: {detail.errorCategory}</p>}
                  {detail.requestId && <p className="text-[#6B7280] lg:col-span-2">Request ID: <span className="font-mono">{detail.requestId}</span></p>}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Document Activity Section ─────────────────────────────────────────────── */

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
    const interval = setInterval(() => {
      if (!document.hidden) { cursorRef.current = null; fetchDocs(); }
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A]">
          <option value="">All Actions</option>
          <option value="upload">Upload</option>
          <option value="download">Download</option>
          <option value="attach">Attach to SoftPro</option>
          <option value="generate">Generate</option>
          <option value="delete">Delete</option>
        </select>
        <span className="ml-auto text-xs text-[#9CA3AF]">Auto-refreshes every 60s</span>
      </div>

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

/* ── Sub-components ────────────────────────────────────────────────────────── */

function StatCard({ label, value, loading, color }: { label: string; value?: number | string; loading: boolean; color?: string }) {
  return (
    <div className="flex-1 min-w-[100px] bg-white border border-gray-200 rounded-lg px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
      {loading ? (
        <div className="h-6 w-12 bg-gray-100 rounded mt-1 animate-pulse" />
      ) : (
        <p className={`text-xl font-bold tabular-nums mt-0.5 ${color ?? 'text-[#1A1A2E]'}`}>{value ?? '—'}</p>
      )}
    </div>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  if (!data) return <p className="text-xs text-[#6B7280] italic">No data</p>;
  let str: string;
  try { str = JSON.stringify(data, null, 2); } catch { str = String(data); }
  const truncated = str.length > 2000;
  const display = truncated ? str.slice(0, 2000) + '\n… (truncated)' : str;
  return (
    <pre className="text-xs text-[#1A1A2E] bg-gray-100 border border-gray-200 rounded-md p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">
      {display}
    </pre>
  );
}
