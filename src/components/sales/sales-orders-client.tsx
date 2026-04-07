'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { RepSelector } from './rep-selector';
import { SalesOrdersTable } from './sales-orders-table';
import { useSalesOrderActions } from './use-sales-order-actions';
import type { SalesOrder } from './types';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_process', label: 'In process' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'duplicate', label: 'Duplicate' },
] as const;

interface ApiResponse {
  orders: SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
}

interface Props {
  role: 'sales_rep' | 'sales_manager';
}

export function SalesOrdersClient({ role }: Props) {
  const [repId, setRepId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { handleOrderAction, modals } = useSalesOrderActions();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, repId]);

  const fetchOrders = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (status) params.set('status', status);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (repId != null) params.set('repId', String(repId));

    fetch(`/api/sales/orders?${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ApiResponse) => {
        setOrders(d.orders ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, status, debouncedSearch, repId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const last = Math.min(page * PAGE_SIZE, total);
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">Orders</h1>
          {role === 'sales_manager' && (
            <RepSelector selectedRepId={repId} onSelect={setRepId} />
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-900
                       focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] sm:order-2"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value || 'all'} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="relative sm:order-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="search"
              placeholder="Search file # or address…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-900
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load orders</p>
          <button
            type="button"
            onClick={fetchOrders}
            className="mt-3 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]"
          >
            Retry
          </button>
        </div>
      )}

      {!error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <SalesOrdersTable
            role={role}
            orders={orders}
            loading={loading}
            onAction={handleOrderAction}
          />
          {!loading && total > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Showing {first}-{last} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700
                             hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700
                             hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modals}
    </div>
  );
}
