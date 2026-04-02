'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface LogEntry {
  id: number;
  eventType: string;
  orderId: number | null;
  channel: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  recipientName: string | null;
  recipientRole: string | null;
  subject: string | null;
  templateUsed: string | null;
  status: string;
  provider: string | null;
  providerId: string | null;
  errorMessage: string | null;
  metadata: unknown;
  createdAt: string;
  sentAt: string | null;
  fileNumber?: string | null;
}

const PAGE_SIZE = 30;

const STATUS_STYLES: Record<string, string> = {
  sent:    'bg-green-100 text-green-800',
  failed:  'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-800',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtType(s: string) {
  return s.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function LogTab() {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (typeFilter) p.set('type', typeFilter);
    if (statusFilter) p.set('status', statusFilter);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    fetch(`/api/admin/notifications/logs?${p}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setRows(d.logs ?? []); setTotal(d.total ?? 0); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, typeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => { setPage(1); }, [typeFilter, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-3 flex flex-wrap gap-3 border-b border-gray-200 bg-gray-50/40">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="h-9 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20">
          <option value="">All Types</option>
          {[...new Set(rows.map(r => r.eventType))].sort().map(t => (
            <option key={t} value={t}>{fmtType(t)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-9 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20">
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From"
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To"
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20" />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Date</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Type</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order #</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Channel</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Recipient</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Provider ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
              ))}</tr>
            )) : rows.length > 0 ? rows.map(r => (
              <LogRow key={r.id} row={r} isExpanded={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
            )) : null}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-[#1A1A2E] font-medium">No notification logs found</p>
            <p className="text-sm text-[#6B7280] mt-1">Logs will appear here as notifications are sent.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing <span className="font-medium">{(page - 1) * PAGE_SIZE + 1}</span>–<span className="font-medium">{Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-medium">{total}</span>
          </p>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
            <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Row with expandable detail ──────────────────────────────────────────── */

function LogRow({ row, isExpanded, onToggle }: { row: LogEntry; isExpanded: boolean; onToggle: () => void }) {
  const recipient = row.recipientName ?? row.recipientEmail ?? row.recipientPhone ?? '—';

  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{fmtDate(row.createdAt)}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{fmtType(row.eventType)}</td>
        <td className="px-4 py-3 font-mono text-xs text-[#1B2A4A] font-medium">{row.fileNumber ?? (row.orderId ? `#${row.orderId}` : '—')}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 capitalize">{row.channel}</span>
        </td>
        <td className="px-4 py-3 text-[#1A1A2E] max-w-[200px] truncate">{recipient}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {row.status}
          </span>
        </td>
        <td className="px-4 py-3 text-[#6B7280] text-xs font-mono truncate max-w-[150px]">{row.providerId ?? '—'}</td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-4 py-4 bg-gray-50/60">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs max-w-2xl">
              {row.subject && <Detail label="Subject" value={row.subject} span />}
              {row.templateUsed && <Detail label="Template" value={row.templateUsed} />}
              {row.provider && <Detail label="Provider" value={row.provider} />}
              {row.recipientRole && <Detail label="Role" value={row.recipientRole.replace(/_/g, ' ')} />}
              {row.sentAt && <Detail label="Sent At" value={fmtDate(row.sentAt)} />}
              {row.errorMessage && (
                <div className="col-span-2 mt-1 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{row.errorMessage}</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <span className="font-medium text-[#6B7280]">{label}:</span>{' '}
      <span className="text-[#1A1A2E]">{value}</span>
    </div>
  );
}
