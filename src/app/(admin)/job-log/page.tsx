'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { JobLogTable, JOB_LOG_PAGE_SIZE } from '@/components/admin/JobLogTable';
import type { JobLogResponse } from '@/components/admin/JobLogTable';

/* ── Filter constants ──────────────────────────────────────────────────────── */

const VENDORS = ['All', 'SoftPro', 'TitlePoint', 'SendGrid', 'SiteX', 'S3'] as const;
const STATUSES = ['All', 'Success', 'Error'] as const;

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function JobLogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramPage = Number(searchParams.get('page') ?? '1');
  const paramVendor = searchParams.get('vendor') ?? 'All';
  const paramStatus = searchParams.get('status') ?? 'All';
  const paramOrder = searchParams.get('order') ?? '';
  const paramFrom = searchParams.get('from') ?? '';
  const paramTo = searchParams.get('to') ?? '';

  const [vendor, setVendor] = useState(paramVendor);
  const [status, setStatus] = useState(paramStatus);
  const [orderNo, setOrderNo] = useState(paramOrder);
  const [dateFrom, setDateFrom] = useState(paramFrom);
  const [dateTo, setDateTo] = useState(paramTo);

  const [data, setData] = useState<JobLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildQs = useCallback(
    (overrides: { page?: number; vendor?: string; status?: string; order?: string; from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      const pg = overrides.page ?? paramPage;
      const v = overrides.vendor ?? paramVendor;
      const s = overrides.status ?? paramStatus;
      const o = overrides.order ?? paramOrder;
      const f = overrides.from ?? paramFrom;
      const t = overrides.to ?? paramTo;

      if (pg > 1) p.set('page', String(pg));
      if (v && v !== 'All') p.set('vendor', v);
      if (s && s !== 'All') p.set('status', s);
      if (o) p.set('order', o);
      if (f) p.set('from', f);
      if (t) p.set('to', t);

      const qs = p.toString();
      return qs ? `/job-log?${qs}` : '/job-log';
    },
    [paramPage, paramVendor, paramStatus, paramOrder, paramFrom, paramTo],
  );

  /* ── Fetch data whenever URL params change ── */
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const api = new URLSearchParams({
      page: String(paramPage),
      limit: String(JOB_LOG_PAGE_SIZE),
    });
    if (paramVendor && paramVendor !== 'All') api.set('vendor', paramVendor.toLowerCase());
    if (paramStatus && paramStatus !== 'All') api.set('status', paramStatus.toLowerCase());
    if (paramOrder) api.set('search', paramOrder);
    if (paramFrom) api.set('dateFrom', paramFrom);
    if (paramTo) api.set('dateTo', paramTo);

    fetch(`/api/admin/job-log?${api}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load job log (${res.status})`);
        return res.json() as Promise<JobLogResponse>;
      })
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [paramPage, paramVendor, paramStatus, paramOrder, paramFrom, paramTo]);

  /* ── Sync local filter state from URL on param change ── */
  useEffect(() => { setVendor(paramVendor); }, [paramVendor]);
  useEffect(() => { setStatus(paramStatus); }, [paramStatus]);
  useEffect(() => { setOrderNo(paramOrder); }, [paramOrder]);
  useEffect(() => { setDateFrom(paramFrom); }, [paramFrom]);
  useEffect(() => { setDateTo(paramTo); }, [paramTo]);

  /* ── Filter handlers ── */
  function applyFilters() {
    router.push(buildQs({ page: 1, vendor, status, order: orderNo, from: dateFrom, to: dateTo }));
  }

  function clearFilters() {
    setVendor('All');
    setStatus('All');
    setOrderNo('');
    setDateFrom('');
    setDateTo('');
    router.push('/job-log');
  }

  function onOrderNoKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyFilters();
  }

  function onOrderNoChange(value: string) {
    setOrderNo(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(buildQs({ page: 1, order: value }));
    }, 500);
  }

  const hasActiveFilters = paramVendor !== 'All' || paramStatus !== 'All' || paramOrder || paramFrom || paramTo;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Job Log</h1>
        <p className="text-sm text-[#6B7280] mt-1">Vendor API call history and diagnostics</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Vendor */}
          <FilterField label="Vendor">
            <select value={vendor} onChange={e => setVendor(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]">
              {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </FilterField>

          {/* Status */}
          <FilterField label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FilterField>

          {/* Order No. */}
          <FilterField label="Order No.">
            <input type="text" value={orderNo}
              onChange={e => onOrderNoChange(e.target.value)}
              onKeyDown={onOrderNoKeyDown}
              placeholder="Search file #"
              className="h-9 w-36 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          {/* Date From */}
          <FilterField label="From">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          {/* Date To */}
          <FilterField label="To">
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          {/* Apply / Clear */}
          <div className="flex items-center gap-2 pb-px">
            <button onClick={applyFilters}
              className="h-9 px-4 text-sm font-medium bg-[#1B2A4A] text-white rounded-md hover:bg-[#243658] transition-colors">
              Apply
            </button>
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="h-9 px-4 text-sm font-medium text-[#6B7280] border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <JobLogTable
        data={data}
        loading={loading}
        error={error}
        currentPage={paramPage}
        onPageChange={page => router.push(buildQs({ page }))}
      />
    </div>
  );
}

/* ── FilterField ───────────────────────────────────────────────────────────── */

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[#6B7280]">{label}</label>
      {children}
    </div>
  );
}
