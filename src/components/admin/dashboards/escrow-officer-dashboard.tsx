'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MetricCard, MetricCardSkeleton, SectionCard,
  ErrorBanner, formatRelative,
} from './shared';
import { EscrowTaskCards } from '@/components/escrow/escrow-task-cards';
import { OrdersHubTable } from '@/components/shared/orders-hub-table';

interface EOStats {
  assignedOrders: number;
  openOrders: number;
  pendingDocuments: number;
  cplGenerated: number;
}

interface DocActivity {
  id: number;
  orderId: number;
  fileNumber: string;
  filename: string;
  action: string;
  performedAt: string;
}

export function EscrowOfficerDashboard({ displayName }: { displayName: string | null }) {
  const [priorityFilter, setPriorityFilter] = useState<1 | 2 | 3 | null>(null);
  const [stats, setStats] = useState<EOStats | null>(null);
  const [docActivity, setDocActivity] = useState<DocActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard/escrow-officer/stats', opts).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/escrow-officer/documents', opts).then((r) => r.ok ? r.json() : { activity: [] }),
    ])
      .then(([s, d]) => { setStats(s); setDocActivity(d.activity ?? []); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      <p className="text-sm text-[#6B7280] mb-4">
        {displayName ? `${displayName.split(' ')[0]}'s` : 'Your'} escrow workload overview.
      </p>

      {/* Row 1: Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <MetricCard label="Assigned Orders" value={stats.assignedOrders.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label="Open Orders" value={stats.openOrders.toLocaleString()} accent="bg-blue-500" />
            <MetricCard
              label="Pending Documents"
              value={stats.pendingDocuments.toLocaleString()}
              accent={stats.pendingDocuments > 0 ? 'bg-amber-500' : 'bg-gray-300'}
            />
            <MetricCard label="CPL Generated" value={stats.cplGenerated.toLocaleString()} accent="bg-green-500" />
          </>
        ) : null}
      </div>

      {/* My Tasks — EscrowTaskCards calls /api/escrow/tasks (scoped to this officer per EW-2) */}
      <div className="mb-6">
        <SectionCard title="My Tasks">
          <EscrowTaskCards
            onFilterChange={setPriorityFilter}
            activeFilter={priorityFilter}
          />
        </SectionCard>
      </div>

      {/* Document Activity */}
      <div className="mb-6">
        <SectionCard title="Document Activity">
          {loading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-1" /><div className="h-3 bg-gray-200 rounded w-1/2" /></div>
              ))}
            </div>
          ) : docActivity.length > 0 ? (
            <div className="divide-y divide-gray-100 overflow-y-auto max-h-80">
              {docActivity.map((d) => (
                <Link key={d.id} href={`/orders/${d.orderId}`} className="block px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#1A1A2E]">
                        <span className="font-semibold text-[#1B2A4A]">{d.fileNumber}</span>
                      </p>
                      <p className="text-xs text-[#6B7280] mt-0.5 truncate">{d.filename}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <DocActionBadge action={d.action} />
                      <p className="text-xs text-[#6B7280] mt-1 whitespace-nowrap">{formatRelative(d.performedAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No recent document activity.</p></div>
          )}
        </SectionCard>
      </div>

      {/* My Orders — ?priority= filtered server-side (escrow-tasks-derivation) */}
      <SectionCard title="My Orders" action={{ label: 'View all →', href: '/orders' }}>
        <OrdersHubTable
          fetchUrl={priorityFilter
            ? `/api/dashboard/escrow-officer/orders?priority=${priorityFilter}`
            : '/api/dashboard/escrow-officer/orders'}
          actions={['cpl', 'proposed', 'notes', 'detail']}
          accentColor="#C5A55A"
          showSearch
          showStatusFilter={false}
          pageSize={10}
        />
      </SectionCard>
    </>
  );
}

function DocActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    uploaded: 'bg-blue-100 text-blue-800',
    attached_to_softpro: 'bg-green-100 text-green-800',
    attach_failed: 'bg-red-100 text-red-800',
    generated: 'bg-purple-100 text-purple-800',
    downloaded: 'bg-gray-100 text-gray-700',
  };
  const labels: Record<string, string> = {
    uploaded: 'Upload',
    attached_to_softpro: 'Attached',
    attach_failed: 'Failed',
    generated: 'Generated',
    downloaded: 'Download',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${colors[action] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[action] ?? action}
    </span>
  );
}
