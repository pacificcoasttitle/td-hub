'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MetricCard, MetricCardSkeleton, StatusBadge, SectionCard,
  ErrorBanner, formatAddress, formatDate, formatRelative,
  type RecentOrder,
} from './shared';

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

interface EscrowOrder extends RecentOrder {
  cplStatus: 'generated' | 'pending' | null;
}

const CPL_BADGE: Record<string, string> = {
  generated: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
};

export function EscrowOfficerDashboard({ displayName }: { displayName: string | null }) {
  const router = useRouter();
  const [stats, setStats] = useState<EOStats | null>(null);
  const [orders, setOrders] = useState<EscrowOrder[]>([]);
  const [docActivity, setDocActivity] = useState<DocActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard/escrow-officer/stats', opts).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/escrow-officer/orders?pageSize=10', opts).then((r) => r.ok ? r.json() : { orders: [] }),
      fetch('/api/dashboard/escrow-officer/documents', opts).then((r) => r.ok ? r.json() : { activity: [] }),
    ])
      .then(([s, o, d]) => { setStats(s); setOrders(o.orders ?? []); setDocActivity(d.activity ?? []); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (error) return <ErrorBanner message={error} />;

  const orderColumns = [
    { key: 'file', label: 'File #', render: (o: RecentOrder) => <span className="font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</span> },
    { key: 'address', label: 'Address', render: (o: RecentOrder) => <span className="text-[#1A1A2E] max-w-xs truncate block">{formatAddress(o.property)}</span> },
    { key: 'status', label: 'Status', render: (o: RecentOrder) => <StatusBadge status={o.operationalStatus} /> },
    { key: 'type', label: 'Type', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap capitalize">{o.transactionType ?? '—'}</span> },
    { key: 'cpl', label: 'CPL Status', render: (o: RecentOrder) => {
      const eo = o as EscrowOrder;
      if (!eo.cplStatus) return <span className="text-[#6B7280]">—</span>;
      return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${CPL_BADGE[eo.cplStatus] ?? 'bg-gray-100 text-gray-600'}`}>{eo.cplStatus}</span>;
    }},
    { key: 'opened', label: 'Opened', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</span> },
  ];

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

      {/* Row 2: Recent Orders + Document Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        <div className="lg:col-span-3">
          <SectionCard title="My Recent Orders" action={{ label: 'View all →', href: '/orders' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">File #</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Status</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">CPL</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}><td className="px-5 py-3" colSpan={4}><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td></tr>
                      ))
                    : orders.slice(0, 10).map((o) => (
                        <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                          <td className="px-5 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</td>
                          <td className="px-5 py-3"><StatusBadge status={o.operationalStatus} /></td>
                          <td className="px-5 py-3">
                            {o.cplStatus ? (
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${CPL_BADGE[o.cplStatus] ?? ''}`}>{o.cplStatus}</span>
                            ) : <span className="text-[#6B7280]">—</span>}
                          </td>
                          <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {!loading && orders.length === 0 && (
                <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No orders assigned to you.</p></div>
              )}
            </div>
          </SectionCard>
        </div>
        <div className="lg:col-span-2">
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
      </div>

      {/* Row 3: Full Orders Table */}
      <SectionCard title="My Orders" action={{ label: 'View all →', href: '/orders' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {orderColumns.map((c) => <th key={c.key} className="text-left px-5 py-2.5 font-medium text-[#6B7280]">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{orderColumns.map((c) => <td key={c.key} className="px-5 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>)}</tr>
                  ))
                : orders.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                      {orderColumns.map((c) => <td key={c.key} className="px-5 py-3">{c.render(o)}</td>)}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && orders.length === 0 && (
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No orders assigned to you yet.</p></div>
          )}
        </div>
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
