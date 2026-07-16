'use client';

import { useEffect, useState } from 'react';
import { formatOrderDate } from '@/lib/domain/orders/date-format';
import { statusLabel } from '@/lib/domain/orders/status-format';

interface OpeningRow {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  transactionType: string | null;
  productType?: string | null;
  orderType?: string | null;
  openedAt: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface OrdersData {
  orders: OpeningRow[];
  total: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  month: number;
  year: number;
  repId?: number | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtAddr(o: OpeningRow): string {
  return [o.address, o.city, o.state].filter(Boolean).join(', ') || '—';
}

function orderTypeLabel(o: OpeningRow): string {
  return o.transactionType ?? o.orderType ?? o.productType ?? '—';
}

export function OpeningsDrilldownModal({ isOpen, onClose, month, year, repId }: Props) {
  const [data, setData] = useState<OrdersData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const timeout = setTimeout(() => {
      setLoading(true);
      setData(null);
      const params = new URLSearchParams({
        page: '1',
        pageSize: '50',
        month: String(month),
        year: String(year),
      });
      if (repId) params.set('repId', String(repId));
      fetch(`/api/sales/orders?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setData(d); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [isOpen, month, year, repId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-auto p-6"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            Orders Opened — {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 pr-3 font-medium text-gray-500">File Number</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Address</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Type</th>
              <th className="text-center py-2 pl-3 font-medium text-gray-500">Opened Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="py-3 px-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data && data.orders.length > 0 ? (
              data.orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="py-2.5 pr-3 text-blue-600 font-medium whitespace-nowrap">{o.fileNumber}</td>
                  <td className="py-2.5 px-3 text-gray-700 max-w-[220px] truncate">{fmtAddr(o)}</td>
                  <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{statusLabel(o.operationalStatus)}</td>
                  <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{orderTypeLabel(o)}</td>
                  <td className="py-2.5 pl-3 text-center text-gray-600 whitespace-nowrap tabular-nums">{formatOrderDate(o.openedAt)}</td>
                </tr>
              ))
            ) : null}
          </tbody>
          {!loading && data && data.orders.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                <td className="py-2.5 pr-3 text-gray-900" colSpan={5}>
                  {data.total} orders opened
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {!loading && (!data || data.orders.length === 0) && (
          <div className="py-10 text-center">
            <p className="text-gray-400">No orders opened in this period</p>
          </div>
        )}
      </div>
    </div>
  );
}
