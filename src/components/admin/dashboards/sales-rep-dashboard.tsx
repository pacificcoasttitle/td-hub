'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MetricCard, MetricCardSkeleton, SectionCard,
  ActivityList, OrdersTable, ErrorBanner, BASE_ORDER_COLUMNS,
  formatCurrency,
  type RecentOrder, type ActivityEntry,
} from './shared';

interface SalesRepStats {
  openOrders: number;
  closedThisMonth: number;
  pipelineValue: number;
  mtd: { revenue: number; closed: number; purchase: number; refinance: number; escrow: number; tsg: number;
    purchaseRevenue: number; refinanceRevenue: number; escrowRevenue: number; tsgRevenue: number } | null;
  yesterday: { closed: number; revenue: number; opens: number } | null;
  prior: { closed: number; revenue: number } | null;
  ranking: { position: number; totalReps: number } | null;
  closingRatio: { closed: number; total: number } | null;
  projected: { revenue: number; workingDaysLeft: number } | null;
}

export function SalesRepDashboard({ displayName }: { displayName: string | null }) {
  const router = useRouter();
  const [stats, setStats] = useState<SalesRepStats | null>(null);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard/sales-rep/stats', opts).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/sales-rep/orders?pageSize=10', opts).then((r) => r.ok ? r.json() : { orders: [] }),
      fetch('/api/dashboard/sales-rep/activity?limit=10', opts).then((r) => r.ok ? r.json() : { activity: [] }),
    ])
      .then(([s, o, a]) => { setStats(s); setOrders(o.orders ?? []); setActivity(a.activity ?? []); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (error) return <ErrorBanner message={error} />;

  const mtd = stats?.mtd;
  const ranking = stats?.ranking;
  const ratio = stats?.closingRatio;
  const projected = stats?.projected;

  return (
    <>
      {/* Greeting */}
      <p className="text-sm text-[#6B7280] mb-4">
        Welcome back{displayName ? `, ${displayName.split(' ')[0]}` : ''}. Here&apos;s your pipeline.
      </p>

      {/* Row 1: Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <MetricCard label="My Open Orders" value={stats.openOrders.toLocaleString()} accent="bg-blue-500" />
            <MetricCard label="Closed This Month" value={(mtd?.closed ?? stats.closedThisMonth).toLocaleString()} accent="bg-green-500" />
            <MetricCard
              label="MTD Revenue"
              value={mtd ? formatCurrency(mtd.revenue) : '—'}
              sub={mtd ? `${mtd.closed} orders closed` : undefined}
              accent="bg-[#C5A55A]"
            />
            <MetricCard
              label="Ranking"
              value={ranking ? `#${ranking.position}` : '—'}
              sub={ranking ? `of ${ranking.totalReps} reps` : 'Unavailable'}
              accent="bg-[#1B2A4A]"
            />
          </>
        ) : null}
      </div>

      {/* Row 2: Yesterday + Production Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Left: Yesterday's Activity */}
        <SectionCard title="Yesterday's Activity">
          {loading ? (
            <div className="p-5 animate-pulse space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-5 bg-gray-200 rounded w-2/3" />)}
            </div>
          ) : stats?.yesterday ? (
            <div className="p-5">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <StatMini label="Closed" value={stats.yesterday.closed.toString()} />
                <StatMini label="Revenue" value={formatCurrency(stats.yesterday.revenue)} />
                <StatMini label="New Opens" value={stats.yesterday.opens.toString()} />
              </div>
              {stats.prior && (
                <div className="text-xs text-[#6B7280] border-t border-gray-100 pt-3">
                  vs prior month: {stats.prior.closed} closed, {formatCurrency(stats.prior.revenue)} revenue
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 text-sm text-[#6B7280]">Data unavailable — Managers Report API not connected.</div>
          )}
        </SectionCard>

        {/* Right: Production Breakdown */}
        <SectionCard title="MTD Production Breakdown">
          {loading ? (
            <div className="p-5 animate-pulse space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-5 bg-gray-200 rounded w-full" />)}
            </div>
          ) : mtd ? (
            <div className="p-5 space-y-3">
              <ProductionBar label="Purchase" count={mtd.purchase} revenue={mtd.purchaseRevenue} total={mtd.closed} />
              <ProductionBar label="Refinance" count={mtd.refinance} revenue={mtd.refinanceRevenue} total={mtd.closed} />
              <ProductionBar label="Escrow" count={mtd.escrow} revenue={mtd.escrowRevenue} total={mtd.closed} />
              <ProductionBar label="TSG" count={mtd.tsg} revenue={mtd.tsgRevenue} total={mtd.closed} />
            </div>
          ) : (
            <div className="p-5 text-sm text-[#6B7280]">Data unavailable — Managers Report API not connected.</div>
          )}
        </SectionCard>
      </div>

      {/* Row 3: Closing Ratio + Projection */}
      {!loading && stats && (ratio || projected) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {ratio && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280] mb-3">Closing Ratio</p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-[#C5A55A] rounded-full transition-all"
                      style={{ width: `${ratio.total > 0 ? Math.round((ratio.closed / ratio.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
                <p className="text-sm font-semibold text-[#1A1A2E] whitespace-nowrap">
                  {ratio.closed}/{ratio.total}
                  <span className="text-[#6B7280] font-normal ml-1">
                    ({ratio.total > 0 ? Math.round((ratio.closed / ratio.total) * 100) : 0}%)
                  </span>
                </p>
              </div>
              <p className="text-xs text-[#6B7280] mt-2">{ratio.closed} orders closed of {ratio.total} total</p>
            </div>
          )}
          {projected && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280] mb-3">Projected This Month</p>
              <p className="text-2xl font-semibold text-[#1A1A2E]">{formatCurrency(projected.revenue)}</p>
              <p className="text-xs text-[#6B7280] mt-1">{projected.workingDaysLeft} working days remaining</p>
            </div>
          )}
        </div>
      )}

      {/* Row 4: My Recent Orders */}
      <SectionCard title="My Recent Orders" action={{ label: 'View all my orders →', href: '/orders' }}>
        <OrdersTable
          orders={orders}
          loading={loading}
          columns={BASE_ORDER_COLUMNS}
          onNavigate={(id) => router.push(`/orders/${id}`)}
          emptyMessage="No orders assigned to you yet."
        />
      </SectionCard>
    </>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold text-[#1A1A2E]">{value}</p>
      <p className="text-xs text-[#6B7280]">{label}</p>
    </div>
  );
}

function ProductionBar({ label, count, revenue, total }: { label: string; count: number; revenue: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[#1A1A2E] font-medium">{label}</span>
        <span className="text-xs text-[#6B7280]">{count} orders · {formatCurrency(revenue)}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-full bg-[#1B2A4A] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
