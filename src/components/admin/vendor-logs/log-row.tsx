'use client';

import { useState } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/components/shared/activity-feed';

export interface LogRow {
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

export function ApiLogRow({ log, expanded, onToggle }: { log: LogRow; expanded: boolean; onToggle: () => void }) {
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
