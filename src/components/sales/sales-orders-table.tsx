'use client';

import { OrderActions } from './order-actions';
import type { SalesAction } from './order-actions';
import type { SalesOrder } from './types';

function fmtAddr(o: SalesOrder): string {
  return [o.address, o.city, o.state].filter(Boolean).join(', ') || '—';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

function orderTypeLabel(o: SalesOrder): string {
  return o.transactionType ?? o.orderType ?? o.productType ?? '—';
}

interface Props {
  role: 'sales_rep' | 'sales_manager';
  orders: SalesOrder[];
  loading: boolean;
  onAction: (action: SalesAction, order: SalesOrder) => void;
}

export function SalesOrdersTable({ role, orders, loading, onAction }: Props) {
  const showRep = role === 'sales_manager';
  const colCount = showRep ? 7 : 6;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">File #</th>
            <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Address</th>
            <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
            <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
            <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Opened</th>
            {showRep && (
              <th className="text-left px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Sales Rep</th>
            )}
            <th className="text-right px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-4/5" />
                    </td>
                  ))}
                </tr>
              ))
            : orders.map(o => (
                <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-blue-600 whitespace-nowrap">{o.fileNumber}</td>
                  <td className="px-5 py-3 text-gray-900 max-w-[220px] truncate">{fmtAddr(o)}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-gray-100 text-gray-700">
                      {(o.operationalStatus ?? '—').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{orderTypeLabel(o)}</td>
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{fmtDate(o.openedAt)}</td>
                  {showRep && (
                    <td className="px-5 py-3 text-gray-700 whitespace-nowrap max-w-[140px] truncate">
                      {o.salesRepName ?? '—'}
                    </td>
                  )}
                  <td className="px-5 py-3 text-right">
                    <OrderActions order={o} onAction={onAction} />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && orders.length === 0 && (
        <div className="p-12 text-center">
          <p className="text-sm text-gray-500">No orders found</p>
        </div>
      )}
    </div>
  );
}
