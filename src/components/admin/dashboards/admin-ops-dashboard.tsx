'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MetricCard, MetricCardSkeleton, StatusBadge, SectionCard,
  formatAddress, formatDate, formatRelative, formatDateTime,
} from './shared';

/* ── Types — new API shapes ──────────────────────────────────────────────── */

interface MetricsData {
  totalOrders: number;
  open: number;
  inProcess: number;
  closedThisMonth: number;
  canceled: number;
  lastSynced: string | null;
}

interface ActivityOrder {
  id: number;
  fileNumber: string;
  address: string | null;
  city?: string | null;
  state?: string | null;
  status: string;
  productType: string | null;
  salesRep: string | null;
  createdBy: string | null;
  createdAt: string;
  property?: { address: string | null; city: string | null; state: string | null } | null;
}

/* ── Types — legacy API for system health (kept intact) ──────────────────── */

interface SystemHealth {
  lastSync: { status: string; endedAt: string | null; startedAt: string | null; error: string | null } | null;
  failedJobs: number;
  documentsUploadedToday: number;
  documentAttachFailuresToday: number;
}

interface WebhookStats {
  todayCount: number;
  latestAt: string | null;
  failedToday: number;
}

interface LegacyDashboard {
  systemHealth: SystemHealth;
  webhooks: WebhookStats;
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function AdminOpsDashboard() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [orders, setOrders] = useState<ActivityOrder[]>([]);
  const [health, setHealth] = useState<LegacyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const o = { signal: ac.signal };

    Promise.all([
      fetch('/api/admin/dashboard/metrics', o).then(r => r.ok ? r.json() as Promise<MetricsData> : null),
      fetch('/api/admin/dashboard/recent-activity', o).then(r => r.ok ? r.json() : null),
      fetch('/api/dashboard', o).then(r => r.ok ? r.json() as Promise<LegacyDashboard> : null),
    ])
      .then(([m, a, h]) => {
        if (m) setMetrics(m);
        setOrders(a?.orders ?? a?.activity ?? []);
        if (h) setHealth(h);
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, []);

  const sys = health?.systemHealth;
  const webhooks = health?.webhooks;
  const syncStatus = sys?.lastSync;
  const syncOk = syncStatus?.status === 'completed';
  const hasFailed = (webhooks?.failedToday ?? 0) > 0;
  const hasAttachFail = (sys?.documentAttachFailuresToday ?? 0) > 0;

  return (
    <>
      {/* ── Row 1: Order Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : metrics ? (
          <>
            <MetricCard label="Total Orders" value={metrics.totalOrders.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label="Open" value={metrics.open.toLocaleString()} accent="bg-blue-500" />
            <MetricCard label="In Process" value={metrics.inProcess.toLocaleString()} accent="bg-amber-500" />
            <MetricCard label="Closed This Month" value={metrics.closedThisMonth.toLocaleString()} accent="bg-green-500" />
            <MetricCard label="Canceled" value={metrics.canceled.toLocaleString()} accent="bg-red-500" />
          </>
        ) : (
          <>
            <MetricCard label="Total Orders" value="—" accent="bg-gray-300" />
            <MetricCard label="Open" value="—" accent="bg-gray-300" />
            <MetricCard label="In Process" value="—" accent="bg-gray-300" />
            <MetricCard label="Closed This Month" value="—" accent="bg-gray-300" />
            <MetricCard label="Canceled" value="—" accent="bg-gray-300" />
          </>
        )}
      </div>

      {/* Last synced timestamp */}
      <div className="mb-6">
        {loading ? (
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
        ) : metrics?.lastSynced ? (
          <p className="text-xs text-[#6B7280]">
            Last synced: {isOlderThan24h(metrics.lastSynced) ? formatDateTime(metrics.lastSynced) : formatRelative(metrics.lastSynced)}
          </p>
        ) : (
          <p className="text-xs text-[#6B7280]">Last synced: unknown</p>
        )}
      </div>

      {/* ── Row 2: Recent Activity Table ── */}
      <div className="mb-6">
        <SectionCard title="Recent Activity" action={{ label: 'View all →', href: '/orders' }}>
          {error && !loading && (
            <div className="px-5 py-4">
              <p className="text-sm text-red-600 font-medium">Failed to load dashboard data</p>
              <p className="text-xs text-[#6B7280] mt-1">{error}</p>
            </div>
          )}
          <RecentActivityTable orders={orders} loading={loading} onRowClick={id => router.push(`/orders/${id}`)} />
        </SectionCard>
      </div>

      {/* ── Row 3: System Health (preserved from existing dashboard) ── */}
      <SectionCard title="System Health">
        {loading ? (
          <div className="p-5 space-y-4 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}><div className="h-3 w-20 bg-gray-200 rounded mb-2" /><div className="h-5 w-28 bg-gray-200 rounded" /></div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            <HealthRow label="SoftPro Sync"
              status={syncStatus ? (syncOk ? 'ok' : 'error') : 'unknown'}
              value={syncStatus?.endedAt ? formatRelative(syncStatus.endedAt) : syncStatus?.startedAt ? 'Running…' : 'Never run'}
              sub={syncStatus && !syncOk && syncStatus.error ? syncStatus.error.slice(0, 80) : syncStatus?.endedAt ? formatDateTime(syncStatus.endedAt) : undefined}
            />
            <HealthRow label="Webhooks"
              status={hasFailed ? 'warning' : 'ok'}
              value={`${webhooks?.todayCount ?? 0} received today`}
              sub={hasFailed ? `${webhooks!.failedToday} failed` : webhooks?.latestAt ? `Latest: ${formatRelative(webhooks.latestAt)}` : undefined}
              href="/jobs?tab=webhooks"
            />
            <HealthRow label="Failed Jobs"
              status={(sys?.failedJobs ?? 0) > 0 ? 'error' : 'ok'}
              value={(sys?.failedJobs ?? 0) > 0 ? `${sys!.failedJobs} need attention` : 'None'}
              href={(sys?.failedJobs ?? 0) > 0 ? '/jobs?tab=jobs&jStatus=failed' : undefined}
            />
            <HealthRow label="Documents"
              status={hasAttachFail ? 'warning' : 'ok'}
              value={`${sys?.documentsUploadedToday ?? 0} uploaded today`}
              sub={hasAttachFail ? `${sys!.documentAttachFailuresToday} attach failures` : undefined}
            />
          </div>
        )}
      </SectionCard>
    </>
  );
}

/* ── Recent Activity Table ───────────────────────────────────────────────── */

function RecentActivityTable({ orders, loading, onRowClick }: {
  orders: ActivityOrder[];
  loading: boolean;
  onRowClick: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {['File No.', 'Address', 'Status', 'Product Type', 'Sales Rep', 'Created By', 'Created'].map(h => (
                <th key={h} className="text-left px-5 py-2.5 font-medium text-[#6B7280]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-5 py-3">
                    <div className={`h-4 bg-gray-200 rounded animate-pulse ${j === 1 ? 'w-40' : j === 6 ? 'w-16' : 'w-20'}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[#6B7280]">No recent orders found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">File No.</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Address</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Status</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Product Type</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Sales Rep</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Created By</th>
            <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.map(o => (
            <tr key={o.id} onClick={() => onRowClick(o.id)} className="hover:bg-gray-50 cursor-pointer transition-colors">
              <td className="px-5 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</td>
              <td className="px-5 py-3 text-[#1A1A2E] max-w-xs truncate">
                {o.address ?? formatAddress(o.property) ?? '—'}
              </td>
              <td className="px-5 py-3 whitespace-nowrap"><StatusBadge status={o.status} /></td>
              <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{o.productType ?? '—'}</td>
              <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{o.salesRep ?? '—'}</td>
              <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{o.createdBy ?? '—'}</td>
              <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{formatRelative(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function isOlderThan24h(iso: string): boolean {
  return (Date.now() - new Date(iso).getTime()) > 86_400_000;
}

function HealthRow({ label, status, value, sub, href }: {
  label: string; status: 'ok' | 'warning' | 'error' | 'unknown'; value: string; sub?: string; href?: string;
}) {
  const dot = { ok: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500', unknown: 'bg-gray-400' }[status];
  const inner = (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">{label}</p>
        <p className="text-sm font-medium text-[#1A1A2E] mt-0.5">{value}</p>
        {sub && <p className={`text-xs mt-0.5 ${status === 'error' || status === 'warning' ? 'text-red-600' : 'text-[#6B7280]'}`}>{sub}</p>}
      </div>
    </div>
  );
  if (href) return <Link href={href} className="block -mx-2 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors">{inner}</Link>;
  return <div>{inner}</div>;
}
