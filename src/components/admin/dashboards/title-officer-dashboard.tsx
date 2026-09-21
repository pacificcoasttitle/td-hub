'use client';

import { useEffect, useState } from 'react';
import {
  MetricCard, MetricCardSkeleton, SectionCard, ErrorBanner,
} from './shared';
import { OrdersHubTable } from '@/components/shared/orders-hub-table';

interface TOStats {
  assignedOrders: number;
  openOrders: number;
  completedThisMonth: number;
  pendingTitlePoint: number;
}

// There used to be a "Pending Tasks" panel here. It fetched
// /api/dashboard/title-officer/pending, which nobody ever wrote, and turned the
// 404 into `{ tasks: [] }` — rendered, in green, as "All caught up! No pending
// tasks." No title officer had an account yet, so nobody saw it; the first one
// would have been told they had nothing to do regardless of what was waiting.
// Removed 2026-09-21. If it comes back, the endpoint comes first.

export function TitleOfficerDashboard({ displayName }: { displayName: string | null }) {
  const [stats, setStats] = useState<TOStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    fetch('/api/dashboard/title-officer/stats', opts)
      .then((r) => r.ok ? r.json() : null)
      .then((s) => { setStats(s); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      <p className="text-sm text-[#6B7280] mb-4">
        {displayName ? `${displayName.split(' ')[0]}'s` : 'Your'} workload at a glance.
      </p>

      {/* Row 1: Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <MetricCard label="Assigned Orders" value={stats.assignedOrders.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label="Open Orders" value={stats.openOrders.toLocaleString()} accent="bg-blue-500" />
            <MetricCard label="Completed This Month" value={stats.completedThisMonth.toLocaleString()} accent="bg-green-500" />
            <MetricCard
              label="Pending TitlePoint"
              value={stats.pendingTitlePoint.toLocaleString()}
              accent={stats.pendingTitlePoint > 0 ? 'bg-amber-500' : 'bg-gray-300'}
            />
          </>
        ) : null}
      </div>

      {/* Row 2: My Orders with modal actions */}
      <SectionCard title="My Orders" action={{ label: 'View all →', href: '/orders' }}>
        <OrdersHubTable
          fetchUrl="/api/dashboard/title-officer/orders"
          actions={['cpl', 'proposed', 'prelim', 'notes', 'detail']}
          accentColor="#C5A55A"
          showSearch
          showStatusFilter={false}
          pageSize={10}
        />
      </SectionCard>
    </>
  );
}
