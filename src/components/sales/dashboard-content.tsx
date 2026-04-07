'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/admin/dashboards/shared';
import { PrelimModal, DetailModal } from '@/components/shared/action-modals';
import { TessaPrelimResultsModal } from '@/components/tessa/TessaPrelimResultsModal';
import { DashboardKpi } from './dashboard-kpi';
import { RepSelector } from './rep-selector';
import { ClosingsDrilldownModal } from './closings-drilldown-modal';
import { OrderActions } from './order-actions';
import type { SalesAction } from './order-actions';
import type { SalesDashboardStats, SalesOrder } from './types';

interface Props {
  displayName: string;
  role: 'sales_rep' | 'sales_manager';
}

const NOW = new Date();
const MONTH_LABEL = `${NOW.toLocaleString('en-US', { month: 'long' })} ${NOW.getFullYear()}`;

function fmtAddr(o: SalesOrder): string {
  return [o.address, o.city, o.state].filter(Boolean).join(', ') || '—';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

export function DashboardContent({ displayName, role }: Props) {
  const [repId, setRepId] = useState<number | null>(null);
  const [stats, setStats] = useState<SalesDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingsOpen, setClosingsOpen] = useState(false);
  const [prelimOrder, setPrelimOrder] = useState<SalesOrder | null>(null);
  const [tessaOrder, setTessaOrder] = useState<SalesOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<SalesOrder | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleOrderAction(action: SalesAction, order: SalesOrder) {
    switch (action) {
      case 'review_prelim':
      case 'update_prelim':
      case 'get_prelim_doc':
        setPrelimOrder(order);
        break;
      case 'prelim_summary':
      case 'regenerate_summary':
        setTessaOrder(order);
        break;
      case 'view_contacts':
        setDetailOrder(order);
        break;
      case 'view_invoice':
        showToast('View Invoice coming soon');
        break;
      case 'view_detail':
        setDetailOrder(order);
        break;
    }
  }

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const url = repId
      ? `/api/sales/dashboard?repId=${repId}`
      : '/api/sales/dashboard';
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => setStats(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [repId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Welcome, {displayName.split(' ')[0]}
          </h1>
          <p className="text-sm text-gray-500">{MONTH_LABEL}</p>
        </div>
        {role === 'sales_manager' && (
          <RepSelector selectedRepId={repId} onSelect={setRepId} />
        )}
      </div>

      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load dashboard</p>
          <button onClick={fetchData}
            className="mt-3 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">
            Retry
          </button>
        </div>
      )}

      <DashboardKpi
        loading={loading}
        stats={stats}
        onOpenClosings={() => setClosingsOpen(true)}
      />

      <SectionCard title="Recent Orders" action={{ label: 'View all orders →', href: '/sales/orders' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-2.5 font-medium text-gray-500">File #</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500">Address</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500">Status</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500">Opened</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                    ))}</tr>
                  ))
                : stats?.orders.slice(0, 10).map(o => (
                    <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-blue-600 whitespace-nowrap">{o.fileNumber}</td>
                      <td className="px-5 py-3 text-gray-900 max-w-[200px] truncate">{fmtAddr(o)}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-gray-100 text-gray-700">
                          {(o.operationalStatus ?? '—').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{fmtDate(o.openedAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <OrderActions order={o} onAction={handleOrderAction} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && (!stats?.orders || stats.orders.length === 0) && (
            <div className="p-8 text-center"><p className="text-sm text-gray-500">No orders found.</p></div>
          )}
        </div>
      </SectionCard>

      <ClosingsDrilldownModal
        isOpen={closingsOpen}
        onClose={() => setClosingsOpen(false)}
        month={NOW.getMonth() + 1}
        year={NOW.getFullYear()}
        repId={repId}
      />

      {prelimOrder && (
        <PrelimModal
          open
          onClose={() => setPrelimOrder(null)}
          orderId={prelimOrder.id}
          fileNumber={prelimOrder.fileNumber}
          address={fmtAddr(prelimOrder)}
        />
      )}

      {detailOrder && (
        <DetailModal
          open
          onClose={() => setDetailOrder(null)}
          orderId={detailOrder.id}
          fileNumber={detailOrder.fileNumber}
          address={fmtAddr(detailOrder)}
        />
      )}

      <TessaPrelimResultsModal
        isOpen={!!tessaOrder}
        onClose={() => setTessaOrder(null)}
        orderId={tessaOrder?.id ?? 0}
        fileNumber={tessaOrder?.fileNumber ?? ''}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1B2A4A] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
