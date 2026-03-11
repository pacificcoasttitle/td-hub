'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from './shared-table';
import { formatDateTime } from './jobs-tab';

interface WebhookLog {
  id: number;
  vendor: string;
  operation: string;
  orderId: number | null;
  requestId: string | null;
  startedAt: string;
  endedAt: string | null;
  success: boolean | null;
  httpStatus: number | null;
  errorCategory: string | null;
  requestMeta: unknown;
  responseMeta: unknown;
  createdAt: string;
}

const PAGE_SIZE = 25;

export function WebhooksTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('wPage') ?? '1');
  const currentType = searchParams.get('wType') ?? '';
  const currentSuccess = searchParams.get('wSuccess') ?? 'all';

  const [data, setData] = useState<{ logs: WebhookLog[]; total: number; types: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'webhooks');
      const page = overrides.wPage ?? currentPage;
      const type = overrides.wType ?? currentType;
      const success = overrides.wSuccess ?? currentSuccess;
      if (Number(page) > 1) params.set('wPage', String(page));
      if (type) params.set('wType', String(type));
      if (success !== 'all') params.set('wSuccess', String(success));
      return `/jobs?${params}`;
    },
    [currentPage, currentType, currentSuccess],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE) });
    if (currentType) apiParams.set('type', currentType);
    if (currentSuccess !== 'all') apiParams.set('success', currentSuccess);
    fetch(`/api/webhooks/log?${apiParams}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`Failed to load webhook logs (${res.status})`); return res.json(); })
      .then((d) => setData({ logs: d.logs, total: d.total, types: d.types ?? [] }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentPage, currentType, currentSuccess]);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const typeOptions = data?.types ?? [];

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={currentType}
          onChange={(e) => router.push(buildUrl({ wType: e.target.value, wPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          <option value="">All Types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{formatOperationLabel(t)}</option>
          ))}
        </select>
        <SuccessToggle
          value={currentSuccess}
          onChange={(v) => router.push(buildUrl({ wSuccess: v, wPage: 1 }))}
        />
        {data && !loading && (
          <span className="text-sm text-[#6B7280] ml-auto">
            {data.total} webhook{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? <ErrorBlock message={error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Payload Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                  : data && data.logs.length > 0
                    ? data.logs.map((log) => (
                        <WebhookRow
                          key={log.id}
                          log={log}
                          expanded={expandedId === log.id}
                          onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.logs.length === 0 && (
              <EmptyState message="No webhook activity found. Webhooks will appear here when SoftPro pushes updates." />
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination
            current={currentPage}
            total={totalPages}
            count={data.total}
            pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ wPage: p }))}
          />
        )}
      </div>
    </>
  );
}

function WebhookRow({ log, expanded, onToggle }: { log: WebhookLog; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <TypeBadge operation={log.operation} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.orderId ? (
            <Link
              href={`/orders/${log.orderId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[#C5A55A] hover:underline font-medium"
            >
              #{log.orderId}
            </Link>
          ) : <span className="text-[#6B7280]">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <StatusIndicator success={log.success} />
        </td>
        <td className="px-4 py-3 max-w-xs truncate">
          <PayloadPreview data={log.requestMeta} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Request Payload</p>
                <JsonBlock data={log.requestMeta} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Response</p>
                <JsonBlock data={log.responseMeta} />
              </div>
              {log.errorCategory && (
                <div className="lg:col-span-2">
                  <p className="text-xs text-red-600 font-medium">Error: {log.errorCategory}</p>
                </div>
              )}
              {log.requestId && (
                <div className="lg:col-span-2">
                  <p className="text-xs text-[#6B7280]">Request ID: <span className="font-mono">{log.requestId}</span></p>
                </div>
              )}
              {log.httpStatus && (
                <div className="lg:col-span-2">
                  <p className="text-xs text-[#6B7280]">HTTP Status: <span className={`font-mono ${log.httpStatus >= 400 ? 'text-red-600' : ''}`}>{log.httpStatus}</span></p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const TYPE_COLORS: Record<string, string> = {
  prelim: 'bg-purple-100 text-purple-800',
  policy: 'bg-blue-100 text-blue-800',
  milestone: 'bg-amber-100 text-amber-800',
};

function TypeBadge({ operation }: { operation: string }) {
  const key = operation.toLowerCase();
  const color = TYPE_COLORS[key] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {formatOperationLabel(operation)}
    </span>
  );
}

function StatusIndicator({ success }: { success: boolean | null }) {
  if (success === null) return <span className="text-[#6B7280] text-xs">Pending</span>;
  return success ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      Success
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      Failed
    </span>
  );
}

function PayloadPreview({ data }: { data: unknown }) {
  if (!data) return <span className="text-xs text-[#6B7280] italic">No payload</span>;
  let str: string;
  try { str = JSON.stringify(data); } catch { str = String(data); }
  const preview = str.length > 80 ? str.slice(0, 80) + '…' : str;
  return <span className="text-xs text-[#6B7280] font-mono">{preview}</span>;
}

function SuccessToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'true', label: 'Success' },
    { value: 'false', label: 'Failed' },
  ];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-[#1B2A4A] text-white'
              : 'bg-white text-[#6B7280] hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
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

function formatOperationLabel(operation: string): string {
  return operation.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
