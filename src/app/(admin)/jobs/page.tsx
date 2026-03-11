'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Job {
  id: number;
  jobType: string;
  orderId: number | null;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

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

// ─── Constants ──────────────────────────────────────────────────────────────

type TabKey = 'jobs' | 'logs';
const PAGE_SIZE = 25;

const JOB_STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  retrying: 'bg-amber-100 text-amber-800',
};

const JOB_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'retrying', label: 'Retrying' },
];

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

// ─── Page ───────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'jobs';

  function setTab(tab: TabKey) {
    router.push(`/jobs?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Jobs &amp; Logs</h1>
        <p className="text-sm text-[#6B7280] mt-1">Monitor sync jobs and vendor API activity</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['jobs', 'Jobs'], ['logs', 'Vendor Logs']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {label}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'jobs' ? <JobsTab /> : <VendorLogsTab />}
    </div>
  );
}

// ─── Jobs Tab ───────────────────────────────────────────────────────────────

function JobsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('jPage') ?? '1');
  const currentStatus = searchParams.get('jStatus') ?? '';
  const currentType = searchParams.get('jType') ?? '';

  const [data, setData] = useState<{ jobs: Job[]; total: number; jobTypes: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'jobs');
      const page = overrides.jPage ?? currentPage;
      const status = overrides.jStatus ?? currentStatus;
      const type = overrides.jType ?? currentType;
      if (Number(page) > 1) params.set('jPage', String(page));
      if (status) params.set('jStatus', String(status));
      if (type) params.set('jType', String(type));
      return `/jobs?${params}`;
    },
    [currentPage, currentStatus, currentType],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE) });
    if (currentStatus) apiParams.set('status', currentStatus);
    if (currentType) apiParams.set('jobType', currentType);

    fetch(`/api/jobs?${apiParams}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load jobs (${res.status})`);
        return res.json();
      })
      .then((d) => setData({ jobs: d.jobs, total: d.total, jobTypes: d.jobTypes ?? [] }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [currentPage, currentStatus, currentType]);

  async function handleRetry(job: Job) {
    setRetryingId(job.id);
    try {
      const res = await fetch(`/api/jobs/run?name=${encodeURIComponent(job.jobType)}`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      router.refresh();
    } catch {
      // Silently fail — the button state resets
    } finally {
      setRetryingId(null);
    }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const typeOptions = data?.jobTypes ?? [];

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={currentStatus}
          onChange={(e) => router.push(buildUrl({ jStatus: e.target.value, jPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          {JOB_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={currentType}
          onChange={(e) => router.push(buildUrl({ jType: e.target.value, jPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          <option value="">All Job Types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {data && !loading && (
          <span className="text-sm text-[#6B7280] ml-auto">{data.total} job{data.total !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Job Type</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Attempts</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Started</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Ended</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Duration</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={8} />)
                  : data && data.jobs.length > 0
                    ? data.jobs.map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          expanded={expandedId === job.id}
                          onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
                          retrying={retryingId === job.id}
                          onRetry={() => handleRetry(job)}
                        />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.jobs.length === 0 && (
              <EmptyState message="No jobs found. Try adjusting your filters." />
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination current={currentPage} total={totalPages} count={data.total} pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ jPage: p }))} />
        )}
      </div>
    </>
  );
}

function JobRow({
  job,
  expanded,
  onToggle,
  retrying,
  onRetry,
}: {
  job: Job;
  expanded: boolean;
  onToggle: () => void;
  retrying: boolean;
  onRetry: () => void;
}) {
  const hasFailed = job.status === 'failed';
  const duration = computeDuration(job.startedAt, job.endedAt);

  return (
    <>
      <tr
        onClick={hasFailed ? onToggle : undefined}
        className={`transition-colors ${hasFailed ? 'hover:bg-red-50/50 cursor-pointer' : 'hover:bg-gray-50'}`}
      >
        <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap font-mono text-xs">{job.jobType}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {job.orderId ? (
            <Link
              href={`/orders/${job.orderId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[#C5A55A] hover:underline font-medium"
            >
              #{job.orderId}
            </Link>
          ) : (
            <span className="text-[#6B7280]">—</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><JobStatusBadge status={job.status} /></td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{job.attempts}/{job.maxAttempts}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(job.startedAt)}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(job.endedAt)}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{duration}</td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {hasFailed && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              disabled={retrying}
              className="px-2.5 py-1 text-xs font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-md hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </td>
      </tr>
      {expanded && hasFailed && job.error && (
        <tr className="bg-red-50/40">
          <td colSpan={8} className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Error</p>
            <pre className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono">
              {job.error}
            </pre>
            {job.nextRetryAt && (
              <p className="text-xs text-[#6B7280] mt-2">Next retry at: {formatDateTime(job.nextRetryAt)}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Vendor Logs Tab ────────────────────────────────────────────────────────

function VendorLogsTab() {
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
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load logs (${res.status})`);
        return res.json();
      })
      .then((d) => setData({ logs: d.logs, total: d.total }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [currentPage, currentVendor, currentSuccess, currentOrderId]);

  function handleOrderSearch(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(buildUrl({ orderId: value, lPage: 1 }));
    }, 400);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative max-w-[180px]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleOrderSearch(e.target.value)}
            placeholder="Order ID…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
          />
        </div>

        <select
          value={currentVendor}
          onChange={(e) => router.push(buildUrl({ vendor: e.target.value, lPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          {VENDOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <SuccessToggle value={currentSuccess} onChange={(v) => router.push(buildUrl({ success: v, lPage: 1 }))} />

        {data && !loading && (
          <span className="text-sm text-[#6B7280] ml-auto">{data.total} log{data.total !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : (
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
                        <LogRow
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
              <EmptyState message="No vendor logs found. Try adjusting your filters." />
            )}
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

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: VendorLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const duration = computeDuration(log.startedAt, log.endedAt);
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap capitalize">{log.vendor}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap font-mono text-xs">{log.operation}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.orderId ? (
            <Link
              href={`/orders/${log.orderId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[#C5A55A] hover:underline font-medium"
            >
              #{log.orderId}
            </Link>
          ) : (
            <span className="text-[#6B7280]">—</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <ResultIcon success={log.success} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {log.httpStatus ? (
            <span className={`font-mono text-xs ${log.httpStatus >= 400 ? 'text-red-600' : 'text-[#6B7280]'}`}>
              {log.httpStatus}
            </span>
          ) : (
            <span className="text-[#6B7280]">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{duration}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={7} className="px-4 py-4">
            <LogDetail log={log} />
          </td>
        </tr>
      )}
    </>
  );
}

function LogDetail({ log }: { log: VendorLog }) {
  return (
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
        <div className="lg:col-span-2">
          <p className="text-xs text-red-600 font-medium">Error category: {log.errorCategory}</p>
        </div>
      )}
      {log.requestId && (
        <div className="lg:col-span-2">
          <p className="text-xs text-[#6B7280]">Request ID: <span className="font-mono">{log.requestId}</span></p>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  if (!data) return <p className="text-xs text-[#6B7280] italic">No data</p>;
  let str: string;
  try {
    str = JSON.stringify(data, null, 2);
  } catch {
    str = String(data);
  }
  const truncated = str.length > 2000;
  const display = truncated ? str.slice(0, 2000) + '\n… (truncated)' : str;
  return (
    <pre className="text-xs text-[#1A1A2E] bg-gray-100 border border-gray-200 rounded-md p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">
      {display}
    </pre>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: string }) {
  const color = JOB_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {status}
    </span>
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
            value === o.value ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
      ))}
    </tr>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-12 text-center">
      <p className="text-[#1A1A2E] font-medium">No results</p>
      <p className="text-sm text-[#6B7280] mt-1">{message}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-red-600 font-medium">{message}</p>
      <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
    </div>
  );
}

function Pagination({
  current, total, count, pageSize, onChange,
}: {
  current: number; total: number; count: number; pageSize: number; onChange: (p: number) => void;
}) {
  const pages = buildPageRange(current, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
      <p className="text-sm text-[#6B7280]">
        Showing <span className="font-medium text-[#1A1A2E]">{(current - 1) * pageSize + 1}</span>–
        <span className="font-medium text-[#1A1A2E]">{Math.min(current * pageSize, count)}</span>{' '}
        of <span className="font-medium text-[#1A1A2E]">{count}</span>
      </p>
      <div className="flex items-center gap-1">
        <PagBtn disabled={current <= 1} onClick={() => onChange(current - 1)}>‹ Prev</PagBtn>
        {pages.map((p, i) =>
          p === null ? <span key={`e${i}`} className="px-1 text-[#6B7280]">…</span>
            : <PagBtn key={p} active={p === current} onClick={() => onChange(p)}>{p}</PagBtn>
        )}
        <PagBtn disabled={current >= total} onClick={() => onChange(current + 1)}>Next ›</PagBtn>
      </div>
    </div>
  );
}

function PagBtn({ children, disabled, active, onClick }: {
  children: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active ? 'bg-[#1B2A4A] text-white' : disabled ? 'text-gray-300 cursor-not-allowed' : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}>{children}</button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return '—'; }
}

function computeDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function buildPageRange(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | null)[] = [1];
  if (current > 3) pages.push(null);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push(null);
  pages.push(total);
  return pages;
}
