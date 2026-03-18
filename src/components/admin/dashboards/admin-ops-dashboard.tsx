'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MetricCard, MetricCardSkeleton, StatusBadge, SectionCard,
  ActivityList, OrdersTable, ErrorBanner,
  formatAddress, formatDate, formatRelative, formatDateTime,
  type RecentOrder, type ActivityEntry,
} from './shared';

interface DashboardStats {
  totalOrders: number;
  openOrders: number;
  closedThisMonth: number;
  lastSyncAt: string | null;
}

interface WebhookStats {
  todayCount: number;
  latestAt: string | null;
  failedToday: number;
}

interface SystemHealth {
  lastSync: { status: string; endedAt: string | null; startedAt: string | null; error: string | null } | null;
  failedJobs: number;
  documentsUploadedToday: number;
  documentAttachFailuresToday: number;
}

interface DashboardData {
  stats: DashboardStats;
  webhooks: WebhookStats;
  systemHealth: SystemHealth;
  recentOrders: RecentOrder[];
}

const ORDER_COLUMNS = [
  { key: 'file', label: 'File #', render: (o: RecentOrder) => <span className="font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</span> },
  { key: 'address', label: 'Address', render: (o: RecentOrder) => <span className="text-[#1A1A2E] max-w-xs truncate block">{formatAddress(o.property)}</span> },
  { key: 'status', label: 'Status', render: (o: RecentOrder) => <StatusBadge status={o.operationalStatus} /> },
  { key: 'opened', label: 'Opened', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</span> },
  { key: 'closed', label: 'Closed', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap">{o.closedAt ? formatDate(o.closedAt) : '—'}</span> },
];

export function AdminOpsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard', opts).then((r) => r.ok ? r.json() as Promise<DashboardData> : null),
      fetch('/api/dashboard/activity?limit=10', opts).then((r) => r.ok ? r.json() as Promise<{ activity: ActivityEntry[] }> : null),
    ])
      .then(([d, a]) => { if (d) setData(d); if (a) setActivity(a.activity); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const health = data?.systemHealth;
  const webhooks = data?.webhooks;
  const syncStatus = health?.lastSync;
  const syncOk = syncStatus?.status === 'completed';
  const hasFailed = (webhooks?.failedToday ?? 0) > 0;
  const hasAttachFail = (health?.documentAttachFailuresToday ?? 0) > 0;

  return (
    <>
      {/* Row 1: Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : data ? (
          <>
            <MetricCard label="Total Orders" value={data.stats.totalOrders.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label="Open Orders" value={data.stats.openOrders.toLocaleString()} accent="bg-blue-500" />
            <MetricCard label="Closed This Month" value={data.stats.closedThisMonth.toLocaleString()} accent="bg-green-500" />
            <SyncCard lastSyncAt={data.stats.lastSyncAt} />
          </>
        ) : (
          <>
            <MetricCard label="Total Orders" value="—" accent="bg-gray-300" />
            <MetricCard label="Open Orders" value="—" accent="bg-gray-300" />
            <MetricCard label="Closed This Month" value="—" accent="bg-gray-300" />
            <MetricCard label="Last Sync" value="—" accent="bg-gray-300" />
          </>
        )}
      </div>

      {/* Row 2: Activity + System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        <div className="lg:col-span-3">
          <SectionCard title="Recent Activity">
            <ActivityList entries={activity} loading={loading} />
          </SectionCard>
        </div>
        <div className="lg:col-span-2">
          <SectionCard title="System Health">
            {loading ? (
              <div className="p-5 space-y-4 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => <div key={i}><div className="h-3 w-20 bg-gray-200 rounded mb-2" /><div className="h-5 w-28 bg-gray-200 rounded" /></div>)}
              </div>
            ) : (
              <div className="px-5 py-4 space-y-5">
                <HealthRow label="SoftPro Sync" status={syncStatus ? (syncOk ? 'ok' : 'error') : 'unknown'}
                  value={syncStatus?.endedAt ? formatRelative(syncStatus.endedAt) : syncStatus?.startedAt ? 'Running…' : 'Never run'}
                  sub={syncStatus && !syncOk && syncStatus.error ? syncStatus.error.slice(0, 80) : syncStatus?.endedAt ? formatDateTime(syncStatus.endedAt) : undefined} />
                <HealthRow label="Webhooks" status={hasFailed ? 'warning' : 'ok'}
                  value={`${webhooks?.todayCount ?? 0} received today`}
                  sub={hasFailed ? `${webhooks!.failedToday} failed` : webhooks?.latestAt ? `Latest: ${formatRelative(webhooks.latestAt)}` : undefined}
                  href="/jobs?tab=webhooks" />
                <HealthRow label="Failed Jobs" status={(health?.failedJobs ?? 0) > 0 ? 'error' : 'ok'}
                  value={(health?.failedJobs ?? 0) > 0 ? `${health!.failedJobs} need attention` : 'None'}
                  href={(health?.failedJobs ?? 0) > 0 ? '/jobs?tab=jobs&jStatus=failed' : undefined} />
                <HealthRow label="Documents" status={hasAttachFail ? 'warning' : 'ok'}
                  value={`${health?.documentsUploadedToday ?? 0} uploaded today`}
                  sub={hasAttachFail ? `${health!.documentAttachFailuresToday} attach failures` : undefined} />
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Row 3: Recent Orders */}
      <SectionCard title="Recent Orders" action={{ label: 'View all →', href: '/orders' }}>
        <OrdersTable orders={data?.recentOrders ?? []} loading={loading} columns={ORDER_COLUMNS} onNavigate={(id) => router.push(`/orders/${id}`)} />
      </SectionCard>
    </>
  );
}

function SyncCard({ lastSyncAt }: { lastSyncAt: string | null }) {
  const { color, dotClass, relText, fullText } = getSyncHealth(lastSyncAt);
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">Last Sync</p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <p className="text-2xl font-semibold text-[#1A1A2E]">{relText}</p>
      </div>
      {fullText && <p className="text-xs text-[#6B7280] mt-1">{fullText}</p>}
    </div>
  );
}

function getSyncHealth(lastSyncAt: string | null) {
  if (!lastSyncAt) return { color: 'bg-red-500', dotClass: 'bg-red-500', relText: 'Never', fullText: undefined };
  const hours = (Date.now() - new Date(lastSyncAt).getTime()) / 3_600_000;
  const color = hours < 1 ? 'bg-green-500' : hours < 24 ? 'bg-amber-500' : 'bg-red-500';
  const dotClass = hours >= 24 ? 'bg-red-500 animate-pulse' : color;
  return { color, dotClass, relText: formatRelative(lastSyncAt), fullText: formatDateTime(lastSyncAt) };
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
