'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from './shared-table';

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

export function JobsTab() {
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
      .then((res) => { if (!res.ok) throw new Error(`Failed to load jobs (${res.status})`); return res.json(); })
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
      // Button state resets
    } finally {
      setRetryingId(null);
    }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const typeOptions = data?.jobTypes ?? [];

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={currentStatus} onChange={(e) => router.push(buildUrl({ jStatus: e.target.value, jPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
          {JOB_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={currentType} onChange={(e) => router.push(buildUrl({ jType: e.target.value, jPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
          <option value="">All Job Types</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {data && !loading && <span className="text-sm text-[#6B7280] ml-auto">{data.total} job{data.total !== 1 ? 's' : ''}</span>}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? <ErrorBlock message={error} /> : (
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
                        <JobRow key={job.id} job={job} expanded={expandedId === job.id}
                          onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
                          retrying={retryingId === job.id} onRetry={() => handleRetry(job)} />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.jobs.length === 0 && <EmptyState message="No jobs found. Try adjusting your filters." />}
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

function JobRow({ job, expanded, onToggle, retrying, onRetry }: {
  job: Job; expanded: boolean; onToggle: () => void; retrying: boolean; onRetry: () => void;
}) {
  const hasFailed = job.status === 'failed';
  const duration = computeDuration(job.startedAt, job.endedAt);
  return (
    <>
      <tr onClick={hasFailed ? onToggle : undefined}
        className={`transition-colors ${hasFailed ? 'hover:bg-red-50/50 cursor-pointer' : 'hover:bg-gray-50'}`}>
        <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap font-mono text-xs">{job.jobType}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {job.orderId ? (
            <Link href={`/orders/${job.orderId}`} onClick={(e) => e.stopPropagation()} className="text-[#C5A55A] hover:underline font-medium">#{job.orderId}</Link>
          ) : <span className="text-[#6B7280]">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><JobStatusBadge status={job.status} /></td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{job.attempts}/{job.maxAttempts}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(job.startedAt)}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(job.endedAt)}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{duration}</td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {hasFailed && (
            <button onClick={(e) => { e.stopPropagation(); onRetry(); }} disabled={retrying}
              className="px-2.5 py-1 text-xs font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-md hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </td>
      </tr>
      {expanded && hasFailed && job.error && (
        <tr className="bg-red-50/40">
          <td colSpan={8} className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Error</p>
            <pre className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono">{job.error}</pre>
            {job.nextRetryAt && <p className="text-xs text-[#6B7280] mt-2">Next retry at: {formatDateTime(job.nextRetryAt)}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const color = JOB_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{status}</span>;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return '—'; }
}

export function computeDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
