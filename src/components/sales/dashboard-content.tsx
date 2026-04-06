'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MetricCard, MetricCardSkeleton, SectionCard, formatCurrency,
} from '@/components/admin/dashboards/shared';
import { PrelimModal, DetailModal } from '@/components/shared/action-modals';
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
        showToast('Prelim Summary coming soon');
        break;
      case 'regenerate_summary':
        showToast('Regenerate Summary coming soon');
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

  const mtd = stats?.mtd;
  const ranking = stats?.ranking;
  const ratio = stats?.closingRatio;
  const projected = stats?.projected;

  return (
    <div>
      {/* Header */}
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

      {/* Error */}
      {error && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center mb-6">
          <p className="text-red-600 font-medium">Failed to load dashboard</p>
          <button onClick={fetchData}
            className="mt-3 text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <div className="min-h-[120px]">
              <MetricCard label="Open Orders" value={stats.openOrders.toLocaleString()} accent="bg-blue-500" />
            </div>
            <button type="button" onClick={() => setClosingsOpen(true)}
              className="group text-left cursor-pointer rounded-lg hover:shadow-md transition-shadow min-h-[120px]">
              <MetricCard label="Closed This Month" value={(mtd?.closed ?? stats.closedThisMonth).toLocaleString()} accent="bg-green-500" />
              <span className="block text-xs text-transparent group-hover:text-blue-500 transition-colors -mt-3 pb-2 px-5">View details →</span>
            </button>
            <button type="button" onClick={() => setClosingsOpen(true)}
              className="group text-left cursor-pointer rounded-lg hover:shadow-md transition-shadow min-h-[120px]">
              <MetricCard
                label="MTD Revenue"
                value={mtd ? formatCurrency(mtd.revenue) : '—'}
                sub={mtd ? `${mtd.closed} orders closed` : undefined}
                accent="bg-[#F26B2B]"
              />
              <span className="block text-xs text-transparent group-hover:text-blue-500 transition-colors -mt-3 pb-2 px-5">View details →</span>
            </button>
            <div className="min-h-[120px]">
              <MetricCard
                label="Ranking"
                value={ranking ? `#${ranking.position}` : '—'}
                sub={ranking ? `of ${ranking.totalReps} reps` : undefined}
                accent="bg-[#1B2A4A]"
              />
            </div>
          </>
        ) : null}
      </div>

      {/* Yesterday + Production Breakdown */}
      {!loading && stats && (stats.yesterday || mtd) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <SectionCard title="Yesterday's Activity">
            {stats.yesterday ? (
              <div className="p-5">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <Mini label="Closed" value={stats.yesterday.closed.toString()} />
                  <Mini label="Revenue" value={formatCurrency(stats.yesterday.revenue)} />
                  <Mini label="New Opens" value={stats.yesterday.opens.toString()} />
                </div>
                {stats.prior && (
                  <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                    Prior month: {stats.prior.closed} closed, {formatCurrency(stats.prior.revenue)}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-5 text-sm text-gray-500">Data not available yet.</div>
            )}
          </SectionCard>

          <SectionCard title="MTD Production Breakdown">
            {mtd ? (
              <div className="p-5 space-y-3">
                <ProdBar label="Purchase" count={mtd.purchase} revenue={mtd.purchaseRevenue} total={mtd.closed} />
                <ProdBar label="Refinance" count={mtd.refinance} revenue={mtd.refinanceRevenue} total={mtd.closed} />
                <ProdBar label="Escrow" count={mtd.escrow} revenue={mtd.escrowRevenue} total={mtd.closed} />
                <ProdBar label="TSG" count={mtd.tsg} revenue={mtd.tsgRevenue} total={mtd.closed} />
                <RevenueSplit mtd={mtd} />
              </div>
            ) : (
              <div className="p-5 text-sm text-gray-500">Data not available yet.</div>
            )}
          </SectionCard>
        </div>
      )}

      {/* Closing Ratio + Projection */}
      {!loading && stats && (ratio || projected) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {ratio && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">Closing Ratio</p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full bg-[#F26B2B] rounded-full transition-all"
                      style={{ width: `${ratio.total > 0 ? Math.round((ratio.closed / ratio.total) * 100) : 0}%` }} />
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  {ratio.closed}/{ratio.total}
                  <span className="text-gray-500 font-normal ml-1">
                    ({ratio.total > 0 ? Math.round((ratio.closed / ratio.total) * 100) : 0}%)
                  </span>
                </p>
              </div>
            </div>
          )}
          {projected && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">Projected This Month</p>
              <p className="text-2xl font-semibold text-gray-900">{formatCurrency(projected.revenue)}</p>
              <p className="text-xs text-gray-500 mt-1">{projected.workingDaysLeft} working days remaining</p>
            </div>
          )}
        </div>
      )}

      {/* Recent Orders */}
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1B2A4A] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ProdBar({ label, count, revenue, total }: {
  label: string; count: number; revenue?: number; total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-900 font-medium">{label}</span>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          <span>{count} orders</span>
          {!!revenue && revenue > 0 && (
            <>
              <span className="text-gray-300">·</span>
              <span>{formatCurrency(revenue)}</span>
            </>
          )}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-full bg-[#1B2A4A] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RevenueSplit({ mtd }: { mtd: SalesDashboardStats['mtd'] }) {
  if (!mtd) return null;
  const total = (mtd.purchaseRevenue || 0) + (mtd.refinanceRevenue || 0)
    + (mtd.escrowRevenue || 0) + (mtd.tsgRevenue || 0);
  if (total <= 0) return null;
  const pPct = Math.round(((mtd.purchaseRevenue || 0) / total) * 100);
  const rPct = Math.round(((mtd.refinanceRevenue || 0) / total) * 100);
  return (
    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
      <span className="text-xs text-gray-500">Revenue Split:</span>
      <span className="text-xs font-medium text-gray-700">Purchase {formatCurrency(mtd.purchaseRevenue)} ({pPct}%)</span>
      <span className="text-xs text-gray-300">|</span>
      <span className="text-xs font-medium text-gray-700">Refinance {formatCurrency(mtd.refinanceRevenue)} ({rPct}%)</span>
    </div>
  );
}
