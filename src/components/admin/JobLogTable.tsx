'use client';

import { useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface JobLogEntry {
  id: number | string;
  orderFileNumber: string | null;
  vendor: string;
  operation: string;
  status: 'success' | 'error';
  durationMs: number;
  timestamp: string;
  requestMeta?: Record<string, unknown> | null;
  responseMeta?: Record<string, unknown> | null;
  errorMessage?: string | null;
}

export interface JobLogResponse {
  logs: JobLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/* ── Constants ─────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 50;
const COL_COUNT = 6;

/* ── Table ─────────────────────────────────────────────────────────────────── */

export function JobLogTable({
  data,
  loading,
  error,
  currentPage,
  onPageChange,
}: {
  data: JobLogResponse | null;
  loading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  function toggleRow(id: string | number) {
    setExpandedId(prev => (prev === id ? null : id));
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-12 text-center">
          <p className="text-red-600 font-medium">Failed to load job log.</p>
          <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <TH>Order No.</TH>
                <TH>Vendor</TH>
                <TH>Operation</TH>
                <TH>Status</TH>
                <TH className="text-right">Duration</TH>
                <TH className="text-right">Timestamp</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
                : data && data.logs.length > 0
                  ? data.logs.map(log => (
                      <LogRow
                        key={log.id}
                        log={log}
                        expanded={expandedId === log.id}
                        onToggle={() => toggleRow(log.id)}
                      />
                    ))
                  : null}
            </tbody>
          </table>
          {!loading && data && data.logs.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">No logs found matching your filters.</p>
              <p className="text-sm text-[#6B7280] mt-1">Try adjusting your filters or date range.</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing{' '}
            <span className="font-medium text-[#1A1A2E]">{(currentPage - 1) * PAGE_SIZE + 1}</span>–
            <span className="font-medium text-[#1A1A2E]">{Math.min(currentPage * PAGE_SIZE, data.total)}</span>{' '}
            of <span className="font-medium text-[#1A1A2E]">{data.total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-2">
            <PagBtn disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
              ← Previous
            </PagBtn>
            <PagBtn disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
              Next →
            </PagBtn>
          </div>
        </div>
      )}
    </div>
  );
}

export { PAGE_SIZE as JOB_LOG_PAGE_SIZE };

/* ── LogRow ────────────────────────────────────────────────────────────────── */

function LogRow({ log, expanded, onToggle }: { log: JobLogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle}
        className={`cursor-pointer transition-colors ${expanded ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
        <td className="px-4 py-3 font-mono text-[#1B2A4A] whitespace-nowrap">
          {log.orderFileNumber ?? '—'}
        </td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap capitalize">
          {log.vendor}
        </td>
        <td className="px-4 py-3 text-[#1A1A2E]">
          {log.operation}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <StatusBadge status={log.status} />
        </td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-right tabular-nums">
          {formatDuration(log.durationMs)}
        </td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-right">
          <span title={formatAbsoluteTime(log.timestamp)}>{formatTimestamp(log.timestamp)}</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COL_COUNT} className="bg-gray-50/80 px-4 py-4 border-t border-gray-100">
            <ExpandedDetail log={log} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Expanded detail ───────────────────────────────────────────────────────── */

function ExpandedDetail({ log }: { log: JobLogEntry }) {
  const hasRequest = log.requestMeta && Object.keys(log.requestMeta).length > 0;
  const hasResponse = log.responseMeta && Object.keys(log.responseMeta).length > 0;
  const hasError = log.status === 'error' && log.errorMessage;

  return (
    <div className="space-y-3 max-w-4xl">
      {hasError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-medium text-red-800 mb-1">Error Message</p>
          <p className="text-sm text-red-700 font-mono">{log.errorMessage}</p>
        </div>
      )}

      {hasRequest && (
        <div>
          <p className="text-xs font-medium text-[#6B7280] mb-1.5">Request Metadata</p>
          <pre className="bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 text-xs text-[#1A1A2E] font-mono overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(log.requestMeta, null, 2)}
          </pre>
        </div>
      )}

      {hasResponse && (
        <div>
          <p className="text-xs font-medium text-[#6B7280] mb-1.5">Response Metadata</p>
          <pre className="bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 text-xs text-[#1A1A2E] font-mono overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(log.responseMeta, null, 2)}
          </pre>
        </div>
      )}

      {!hasRequest && !hasResponse && !hasError && (
        <p className="text-sm text-[#9CA3AF] italic">No additional detail available for this log entry.</p>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: 'success' | 'error' }) {
  const cls = status === 'success'
    ? 'bg-green-100 text-green-800'
    : 'bg-red-100 text-red-800';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function SkeletonRow() {
  const widths = ['w-20', 'w-16', 'w-28', 'w-14', 'w-12', 'w-24'];
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 bg-gray-200 rounded animate-pulse ${w} ${i >= 4 ? 'ml-auto' : ''}`} />
        </td>
      ))}
    </tr>
  );
}

function PagBtn({ children, disabled, onClick }: {
  children: React.ReactNode; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium rounded-md border transition-colors ${
        disabled
          ? 'text-gray-300 border-gray-200 cursor-not-allowed bg-white'
          : 'text-[#1A1A2E] border-gray-200 hover:bg-gray-100 bg-white'
      }`}>
      {children}
    </button>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function formatAbsoluteTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}
