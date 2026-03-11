'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OrderFilters } from '@/components/admin/order-filters';
import { OrderTable, PAGE_SIZE } from '@/components/admin/order-table';
import type { OrderListResponse } from '@/components/admin/order-table';

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
        <Link
          href="/orders/new"
          className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors inline-flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Order
        </Link>
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
