'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface DeliveryLogRecipient {
  email: string;
  name: string | null;
  role: string | null;
  kind: 'to' | 'cc';
}

interface DeliveryLogRow {
  id: string;
  source: 'admin_activity' | 'vendor_api' | 'notification_log';
  type: string;
  orderId: number | null;
  fileNumber: string | null;
  subject: string | null;
  recipients: DeliveryLogRecipient[];
  timestamp: string;
  status: 'sent' | 'failed' | 'pending' | 'skipped';
  sendgridMessageId: string | null;
  softproNoteId: string | null;
  softproSynced: boolean | null;
  proof: string | null;
}

interface DeliveryLogResponse {
  rows: DeliveryLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  types: string[];
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const STATUS_STYLES: Record<DeliveryLogRow['status'], string> = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-800',
  skipped: 'bg-gray-100 text-gray-700',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtType(s: string) {
  return s.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function recipientLabel(recipient: DeliveryLogRecipient) {
  const name = recipient.name ? `${recipient.name} ` : '';
  const role = recipient.role ? ` (${recipient.role.replace(/_/g, ' ')})` : '';
  return `${recipient.kind.toUpperCase()}: ${name}<${recipient.email}>${role}`;
}

export function DeliveryLogTab() {
  const [rows, setRows] = useState<DeliveryLogRow[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchRows = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (typeFilter) p.set('type', typeFilter);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (search) p.set('search', search);
    fetch(`/api/admin/notifications/delivery-log?${p}`)
      .then(r => r.ok ? r.json() as Promise<DeliveryLogResponse> : null)
      .then(d => {
        if (!d) return;
        setRows(d.rows ?? []);
        setTypes(d.types ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, pageSize, typeFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    const id = setTimeout(fetchRows, 0);
    return () => clearTimeout(id);
  }, [fetchRows]);
  useEffect(() => {
    const id = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(id);
  }, [typeFilter, dateFrom, dateTo, search, pageSize]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setSearch(value), 300);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap gap-3 border-b border-gray-200 bg-gray-50/40">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="h-9 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20">
          <option value="">All Types</option>
          {types.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20" />
        <input type="search" value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          placeholder="Search file, subject, recipient, message id..."
          className="h-9 min-w-[260px] flex-1 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20" />
        <label className="inline-flex items-center gap-2 text-sm text-[#6B7280]">
          Show
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-9 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20">
            {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Timestamp</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Type</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order/File</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Recipients</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
              ))}</tr>
            )) : rows.length > 0 ? rows.map(row => (
              <DeliveryRow key={row.id} row={row} isExpanded={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} />
            )) : null}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-[#1A1A2E] font-medium">No delivery logs found</p>
            <p className="text-sm text-[#6B7280] mt-1">Email delivery proof rows will appear here as SendGrid and notification logs are recorded.</p>
          </div>
        )}
      </div>

      {!loading && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            {total > 0 ? <>Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span>–<span className="font-medium">{Math.min(page * pageSize, total)}</span> of <span className="font-medium">{total}</span></> : '0 deliveries'}
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

function DeliveryRow({ row, isExpanded, onToggle }: { row: DeliveryLogRow; isExpanded: boolean; onToggle: () => void }) {
  const recipients = row.recipients.length > 0 ? row.recipients.map(recipientLabel).join(', ') : '—';

  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{fmtDate(row.timestamp)}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{fmtType(row.type)}</td>
        <td className="px-4 py-3 font-mono text-xs text-[#1B2A4A] font-medium whitespace-nowrap">
          {row.orderId ? <Link href={`/orders/${row.orderId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{row.fileNumber ?? `#${row.orderId}`}</Link> : row.fileNumber ?? '—'}
        </td>
        <td className="px-4 py-3 text-[#1A1A2E] max-w-[300px] truncate" title={recipients}>{recipients}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[row.status]}`}>
            {row.status}
          </span>
        </td>
        <td className="px-4 py-3 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {row.sendgridMessageId && <ProofBadge label={`SendGrid ${row.sendgridMessageId}`} />}
            {row.softproNoteId && <ProofBadge label={`SoftPro ${row.softproSynced ? 'synced ✓' : 'pending'}`} tone={row.softproSynced ? 'green' : 'amber'} />}
            {!row.sendgridMessageId && !row.softproNoteId && <span className="text-[#9CA3AF]">—</span>}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4 bg-gray-50/60">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs max-w-4xl">
              {row.subject && <Detail label="Subject" value={row.subject} span />}
              <Detail label="Source" value={row.source.replace(/_/g, ' ')} />
              {row.sendgridMessageId && <Detail label="SendGrid Message ID" value={row.sendgridMessageId} />}
              {row.softproNoteId && <Detail label="SoftPro Note ID" value={row.softproNoteId} />}
              {row.proof && <Detail label="Proof" value={row.proof} span />}
              {row.recipients.length > 0 && <Detail label="Recipients" value={recipients} span />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ProofBadge({ label, tone = 'blue' }: { label: string; tone?: 'blue' | 'green' | 'amber' }) {
  const styles = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  }[tone];
  return <span className={`px-2 py-0.5 rounded border font-mono text-[10px] ${styles}`}>{label}</span>;
}

function Detail({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <span className="font-medium text-[#6B7280]">{label}:</span>{' '}
      <span className="text-[#1A1A2E]">{value}</span>
    </div>
  );
}
