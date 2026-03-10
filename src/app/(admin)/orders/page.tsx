'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
}

interface Order {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  salesRepId: number | null;
  salesRepName?: string | null;
  openedAt: string;
  property: OrderProperty | null;
}

interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_process', label: 'In Process' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'duplicate', label: 'Duplicate' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

const PAGE_SIZE = 25;

// ─── Component ──────────────────────────────────────────────────────────────

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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

    const apiParams = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(PAGE_SIZE),
    });
    if (currentStatus) apiParams.set('status', currentStatus);
    if (currentSearch) apiParams.set('search', currentSearch);

    fetch(`/api/orders?${apiParams}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
        return res.json() as Promise<OrderListResponse>;
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [currentPage, currentStatus, currentSearch]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(buildUrl({ search: value, page: 1 }));
    }, 300);
  }

  function handleStatusChange(status: string) {
    router.push(buildUrl({ status, page: 1 }));
  }

  function handlePageChange(page: number) {
    router.push(buildUrl({ page }));
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Orders</h1>
          {data && !loading && (
            <p className="text-sm text-[#6B7280] mt-1">
              {data.total} order{data.total !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search file number or address…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
          />
        </div>

        <select
          value={currentStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <p className="text-red-600 font-medium">{error}</p>
            <p className="text-sm text-[#6B7280] mt-1">
              Check your connection and try again.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    File #
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    Address
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    Sales Rep
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">
                    Opened
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))
                  : data && data.orders.length > 0
                    ? data.orders.map((order) => (
                        <tr
                          key={order.id}
                          onClick={() => router.push(`/orders/${order.id}`)}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">
                            {order.fileNumber}
                          </td>
                          <td className="px-4 py-3 text-[#1A1A2E] max-w-xs truncate">
                            {formatAddress(order.property)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <StatusBadge status={order.operationalStatus} />
                          </td>
                          <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">
                            {order.transactionType ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">
                            {order.salesRepName ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
                            {formatDate(order.openedAt)}
                          </td>
                        </tr>
                      ))
                    : null}
              </tbody>
            </table>

            {/* Empty state */}
            {!loading && data && data.orders.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No orders found</p>
                <p className="text-sm text-[#6B7280] mt-1">
                  Try adjusting your search or filters.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && data && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
            <p className="text-sm text-[#6B7280]">
              Showing{' '}
              <span className="font-medium text-[#1A1A2E]">
                {(currentPage - 1) * PAGE_SIZE + 1}
              </span>
              –
              <span className="font-medium text-[#1A1A2E]">
                {Math.min(currentPage * PAGE_SIZE, data.total)}
              </span>{' '}
              of{' '}
              <span className="font-medium text-[#1A1A2E]">{data.total}</span>
            </p>
            <div className="flex items-center gap-1">
              <PaginationButton
                disabled={currentPage <= 1}
                onClick={() => handlePageChange(currentPage - 1)}
              >
                ‹ Prev
              </PaginationButton>
              <PageNumbers
                current={currentPage}
                total={totalPages}
                onChange={handlePageChange}
              />
              <PaginationButton
                disabled={currentPage >= totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
              >
                Next ›
              </PaginationButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  const label = status.replace(/_/g, ' ');
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}
    >
      {label}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

function PaginationButton({
  children,
  disabled,
  active,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active
          ? 'bg-[#1B2A4A] text-white'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function PageNumbers({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = buildPageRange(current, total);
  return (
    <>
      {pages.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="px-1 text-[#6B7280]">
            …
          </span>
        ) : (
          <PaginationButton
            key={p}
            active={p === current}
            onClick={() => onChange(p)}
          >
            {p}
          </PaginationButton>
        ),
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAddress(property: OrderProperty | null): string {
  if (!property) return '—';
  const parts = [property.address, property.city, property.state].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(', ') : '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function buildPageRange(
  current: number,
  total: number,
): (number | null)[] {
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
