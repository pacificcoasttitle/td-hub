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

const thCls = 'text-left px-5 py-2.5 font-medium text-gray-500 border-r border-gray-100';
const thLast = 'text-right px-5 py-2.5 font-medium text-gray-500';
const tdBr = 'border-r border-gray-100';

export function SalesOrdersTable({ role, orders, loading, onAction }: Props) {
  const showRep = role === 'sales_manager';
  const colCount = showRep ? 7 : 6;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        {showRep ? (
          <colgroup>
            <col style={{ width: '100px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '150px' }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: '110px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '160px' }} />
          </colgroup>
        )}
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            <th className={thCls}>File #</th>
            <th className={thCls}>Address</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Type</th>
            {showRep && <th className={thCls}>Sales Rep</th>}
            <th className={thCls}>Opened</th>
            <th className={thLast}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-4/5" />
                    </td>
                  ))}
                </tr>
              ))
            : orders.map(o => {
                const addr = fmtAddr(o);
                return (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    <td className={`px-5 py-3 font-medium text-blue-600 whitespace-nowrap ${tdBr}`}>{o.fileNumber}</td>
                    <td className={`px-4 py-3 truncate text-gray-900 max-w-[180px] ${tdBr}`} title={addr}>
                      {addr}
                    </td>
                    <td className={`px-5 py-3 whitespace-nowrap ${tdBr}`}>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-gray-100 text-gray-700">
                        {(o.operationalStatus ?? '—').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-gray-700 whitespace-nowrap truncate ${tdBr}`}>{orderTypeLabel(o)}</td>
                    {showRep && (
                      <td className={`px-5 py-3 text-gray-700 whitespace-nowrap truncate ${tdBr}`}>
                        {o.salesRepName ?? '—'}
                      </td>
                    )}
                    <td className={`px-5 py-3 text-gray-500 whitespace-nowrap ${tdBr}`}>{fmtDate(o.openedAt)}</td>
                    <td className="px-2 py-3 text-right">
                      <OrderActions order={o} onAction={onAction} />
                    </td>
                  </tr>
                );
              })}
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
