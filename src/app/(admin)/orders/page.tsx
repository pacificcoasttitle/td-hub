'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { OrderFilters } from '@/components/admin/order-filters';
import { OrderTable, PAGE_SIZE } from '@/components/admin/order-table';
import type { OrderListResponse } from '@/components/admin/order-table';

function ImportButton() {
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setImporting(true);
    setToast(null);
    try {
      const now = new Date();
      const dateTo = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${now.getFullYear()}`;
      const past = new Date(now);
      past.setFullYear(past.getFullYear() - 1);
      const dateFrom = `${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}-${past.getFullYear()}`;

      const res = await fetch('/api/orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      const msg = `Imported ${body?.imported ?? 0}, updated ${body?.updated ?? 0} of ${body?.total ?? 0} (${body?.errors?.length ?? 0} errors)`;
      setToast({ ok: true, msg });
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      setImporting(false);
      setTimeout(() => setToast(null), 8000);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={run} disabled={importing}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-[#1B2A4A] bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors">
        <svg className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
        </svg>
        {importing ? 'Importing...' : 'Import Orders'}
      </button>
      {toast && (
        <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${toast.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}

function EnrichButton() {
  const [enriching, setEnriching] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setEnriching(true);
    setToast(null);
    try {
      const res = await fetch('/api/orders/enrich', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      const msg = `Enriched ${body?.enriched ?? 0} orders (${body?.skipped ?? 0} skipped, ${body?.errors?.length ?? 0} errors)`;
      setToast({ ok: true, msg });
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : 'Enrichment failed' });
    } finally {
      setEnriching(false);
      setTimeout(() => setToast(null), 8000);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={run} disabled={enriching}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-[#1B2A4A] bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors">
        <svg className={`h-4 w-4 ${enriching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {enriching ? 'Enriching...' : 'Enrich Orders'}
      </button>
      {toast && (
        <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${toast.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('page') ?? '1');
  const currentStatus = searchParams.get('status') ?? '';
  const currentSearch = searchParams.get('search') ?? '';

  const [data, setData] = useState<OrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = useCallback(
    (overrides: { page?: number; status?: string; search?: string }) => {
      const params = new URLSearchParams();
      const page = overrides.page ?? currentPage;
      const status = overrides.status ?? currentStatus;
      const search = overrides.search ?? currentSearch;
      if (page > 1) params.set('page', String(page));
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const qs = params.toString();
      return qs ? `/orders?${qs}` : '/orders';
    },
    [currentPage, currentStatus, currentSearch],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE) });
    if (currentStatus) apiParams.set('status', currentStatus);
    if (currentSearch) apiParams.set('search', currentSearch);
    fetch(`/api/orders?${apiParams}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`Failed to load orders (${res.status})`); return res.json() as Promise<OrderListResponse>; })
      .then(setData)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentPage, currentStatus, currentSearch]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { router.push(buildUrl({ search: value, page: 1 })); }, 300);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Orders</h1>
          {data && !loading && (
            <p className="text-sm text-[#6B7280] mt-1">{data.total} order{data.total !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ImportButton />
          <EnrichButton />
        </div>
      </div>

      <OrderFilters
        searchInput={searchInput}
        onSearchChange={handleSearchChange}
        currentStatus={currentStatus}
        onStatusChange={(status) => router.push(buildUrl({ status, page: 1 }))}
      />

      <OrderTable
        orders={data?.orders}
        loading={loading}
        error={error}
        currentPage={currentPage}
        totalPages={totalPages}
        total={data?.total ?? 0}
        onPageChange={(page) => router.push(buildUrl({ page }))}
        onRowClick={(id) => router.push(`/orders/${id}`)}
      />
    </div>
  );
}
