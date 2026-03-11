'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Order {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  openedAt: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface ApiResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_process: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  canceled: 'bg-red-50 text-red-700',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ClientOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const search = searchParams.get('search') ?? '';

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchOrders = useCallback((p: number, s: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    const url = buildUrl(p, s);
    fetch(url, { signal })
      .then((r) => r.ok ? r.json() : Promise.reject('Failed to load orders'))
      .then((d) => setData(d))
      .catch((err) => { if (err !== 'AbortError' && err?.name !== 'AbortError') setError(typeof err === 'string' ? err : 'Something went wrong'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchOrders(page, search, ac.signal);
    return () => ac.abort();
  }, [fetchOrders, page, search]);

  function pushParams(newPage: number, newSearch: string) {
    const params = new URLSearchParams();
    if (newSearch) params.set('search', newSearch);
    if (newPage > 1) params.set('page', String(newPage));
    const qs = params.toString();
    router.push(`/client/orders${qs ? `?${qs}` : ''}`);
  }

  function handleSearchChange(value: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams(1, value), 300);
  }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">My Orders</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          {data && !loading ? `${data.total} order${data.total !== 1 ? 's' : ''}` : '\u00A0'}
        </p>
      </div>

      {/* Search */}
      <div className="mb-5">
        <div className="relative max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            defaultValue={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by file number or address…"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]/40"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">File #</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Address</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Type</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && !data &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              }

              {data && data.orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-[#6B7280]">
                    {search ? `No orders found for "${search}"` : 'No orders to display.'}
                  </td>
                </tr>
              )}

              {data && data.orders.map((o) => {
                const addr = [o.address, o.city, o.state].filter(Boolean).join(', ');
                const statusStyle = STATUS_STYLES[o.operationalStatus] ?? 'bg-gray-50 text-gray-600';
                return (
                  <tr
                    key={o.id}
                    onClick={() => router.push(`/client/orders/${o.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-4 font-medium text-[#1A1A2E] whitespace-nowrap">{o.fileNumber}</td>
                    <td className="px-5 py-4 text-[#374151] max-w-xs truncate">{addr || '—'}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyle}`}>
                        {o.operationalStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{o.transactionType ?? '—'}</td>
                    <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-sm text-[#6B7280]">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <PaginationBtn
              disabled={page <= 1}
              onClick={() => pushParams(page - 1, search)}
            >
              Previous
            </PaginationBtn>
            {buildPageRange(page, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="px-2 py-1.5 text-sm text-[#6B7280]">…</span>
              ) : (
                <PaginationBtn
                  key={p}
                  active={p === page}
                  onClick={() => pushParams(p as number, search)}
                >
                  {p}
                </PaginationBtn>
              ),
            )}
            <PaginationBtn
              disabled={page >= totalPages}
              onClick={() => pushParams(page + 1, search)}
            >
              Next
            </PaginationBtn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildUrl(page: number, search: string) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '25');
  if (search) params.set('search', search);
  return `/api/client/orders?${params}`;
}

function buildPageRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

function PaginationBtn({
  children, disabled, active, onClick,
}: {
  children: React.ReactNode; disabled?: boolean; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        active
          ? 'bg-[#1B2A4A] text-white border-[#1B2A4A]'
          : disabled
            ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
            : 'bg-white text-[#374151] border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
