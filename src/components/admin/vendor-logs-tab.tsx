'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from './shared-table';
import { formatDateTime, computeDuration } from './jobs-tab';

interface VendorLog {
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

const VENDOR_OPTIONS = [
  { value: '', label: 'All Vendors' },
  { value: 'softpro', label: 'SoftPro' },
  { value: 's3', label: 'S3' },
  { value: 'titlepoint', label: 'TitlePoint' },
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF' },
  { value: 'natic', label: 'NATIC' },
  { value: 'doma', label: 'Doma' },
];

export function VendorLogsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('lPage') ?? '1');
  const currentVendor = searchParams.get('vendor') ?? '';
  const currentSuccess = searchParams.get('success') ?? 'all';
  const currentOrderId = searchParams.get('orderId') ?? '';

  const [data, setData] = useState<{ logs: VendorLog[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState(currentOrderId);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'logs');
      const page = overrides.lPage ?? currentPage;
      const vendor = overrides.vendor ?? currentVendor;
      const success = overrides.success ?? currentSuccess;
      const orderId = overrides.orderId ?? currentOrderId;
      if (Number(page) > 1) params.set('lPage', String(page));
      if (vendor) params.set('vendor', String(vendor));
      if (success !== 'all') params.set('success', String(success));
      if (orderId) params.set('orderId', String(orderId));
      return `/jobs?${params}`;
    },
    [currentPage, currentVendor, currentSuccess, currentOrderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE), success: currentSuccess });
    if (currentVendor) apiParams.set('vendor', currentVendor);
    if (currentOrderId) apiParams.set('orderId', currentOrderId);
    fetch(`/api/logs?${apiParams}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`Failed to load logs (${res.status})`); return res.json(); })
      .then((d) => setData({ logs: d.logs, total: d.total }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentPage, currentVendor, currentSuccess, currentOrderId]);

  function handleOrderSearch(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { router.push(buildUrl({ orderId: value, lPage: 1 })); }, 400);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative max-w-[180px]">
          <input type="text" value={searchInput} onChange={(e) => handleOrderSearch(e.target.value)} placeholder="Order ID…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white" />
        </div>
        <select value={currentVendor} onChange={(e) => router.push(buildUrl({ vendor: e.target.value, lPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
          {VENDOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <SuccessToggle value={currentSuccess} onChange={(v) => router.push(buildUrl({ success: v, lPage: 1 }))} />
        {data && !loading && <span className="text-sm text-[#6B7280] ml-auto">{data.total} log{data.total !== 1 ? 's' : ''}</span>}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? <ErrorBlock message={error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Operation</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Result</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">HTTP</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Duration</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
                  : data && data.logs.length > 0
                    ? data.logs.map((log) => (
                        <LogRow key={log.id} log={log} expanded={expandedId === log.id}
                          onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)} />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.logs.length === 0 && <EmptyState message="No vendor logs found. Try adjusting your filters." />}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination current={currentPage} total={totalPages} count={data.total} pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ lPage: p }))} />
        )}
      </div>
    </>
  );
}

function LogRow({ log, expanded, onToggle }: { log: VendorLog; expanded: boolean; onToggle: () => void }) {
  const duration = computeDuration(log.startedAt, log.endedAt);
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap capitalize">{log.vendor}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap font-mono text-xs">{log.operation}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.orderId ? (
            <Link href={`/orders/${log.orderId}`} onClick={(e) => e.stopPropagation()} className="text-[#C5A55A] hover:underline font-medium">#{log.orderId}</Link>
          ) : <span className="text-[#6B7280]">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><ResultIcon success={log.success} /></td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.httpStatus ? (
            <span className={`font-mono text-xs ${log.httpStatus >= 400 ? 'text-red-600' : 'text-[#6B7280]'}`}>{log.httpStatus}</span>
          ) : <span className="text-[#6B7280]">—</span>}
        </td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{duration}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Request Metadata</p>
                <JsonBlock data={log.requestMeta} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Response Metadata</p>
                <JsonBlock data={log.responseMeta} />
              </div>
              {log.errorCategory && (
                <div className="lg:col-span-2"><p className="text-xs text-red-600 font-medium">Error category: {log.errorCategory}</p></div>
              )}
              {log.requestId && (
                <div className="lg:col-span-2"><p className="text-xs text-[#6B7280]">Request ID: <span className="font-mono">{log.requestId}</span></p></div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ResultIcon({ success }: { success: boolean | null }) {
  if (success === null) return <span className="text-[#6B7280] text-xs">—</span>;
  return success ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      Success
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      Failed
    </span>
  );
}

function SuccessToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [{ value: 'all', label: 'All' }, { value: 'true', label: 'Success' }, { value: 'false', label: 'Failed' }];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${value === o.value ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
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
