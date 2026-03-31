'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MetricCard, MetricCardSkeleton, SectionCard,
  ErrorBanner, formatRelative,
} from './shared';
import { OrdersHubTable } from '@/components/shared/orders-hub-table';

interface TOStats {
  assignedOrders: number;
  openOrders: number;
  completedThisMonth: number;
  pendingTitlePoint: number;
}

interface PendingTask {
  id: number;
  orderId: number;
  fileNumber: string;
  type: 'titlepoint' | 'document_attach';
  description: string;
  createdAt: string;
}

export function TitleOfficerDashboard({ displayName }: { displayName: string | null }) {
  const [stats, setStats] = useState<TOStats | null>(null);
  const [pending, setPending] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard/title-officer/stats', opts).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/title-officer/pending', opts).then((r) => r.ok ? r.json() : { tasks: [] }),
    ])
      .then(([s, p]) => { setStats(s); setPending(p.tasks ?? []); })
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

      {/* Row 2: Pending Tasks */}
      <div className="mb-6">
        <SectionCard title="Pending Tasks">
          {loading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-5 py-3 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-1" /><div className="h-3 bg-gray-200 rounded w-1/2" /></div>
              ))}
            </div>
          ) : pending.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {pending.map((t) => (
                <Link key={t.id} href={`/orders/${t.orderId}`} className="block px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#1A1A2E]">
                        <span className="font-semibold text-[#1B2A4A]">{t.fileNumber}</span>
                      </p>
                      <p className="text-xs text-[#6B7280] mt-0.5">{t.description}</p>
                    </div>
                    <div className="flex-shrink-0">
                      <TaskTypeBadge type={t.type} />
                      <p className="text-xs text-[#6B7280] mt-1 whitespace-nowrap">{formatRelative(t.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-green-600 font-medium">All caught up!</p>
              <p className="text-xs text-[#6B7280] mt-1">No pending tasks.</p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Row 3: My Orders with modal actions */}
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

function TaskTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    titlepoint: 'bg-purple-100 text-purple-800',
    document_attach: 'bg-amber-100 text-amber-800',
  };
  const labels: Record<string, string> = {
    titlepoint: 'TitlePoint',
    document_attach: 'Doc Attach',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[type] ?? type}
    </span>
  );
}
