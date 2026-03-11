'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  lastSync: {
    status: string;
    endedAt: string | null;
    startedAt: string | null;
    error: string | null;
  } | null;
  failedJobs: number;
  documentsUploadedToday: number;
  documentAttachFailuresToday: number;
}

interface RecentOrder {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  openedAt: string;
  closedAt: string | null;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

interface ActivityEntry {
  id: number;
  orderId: number;
  fileNumber: string;
  status: string;
  source: string;
  notes: string | null;
  changedAt: string;
}

interface DashboardData {
  stats: DashboardStats;
  webhooks: WebhookStats;
  systemHealth: SystemHealth;
  recentOrders: RecentOrder[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

const SOURCE_COLORS: Record<string, string> = {
  softpro_sync: 'bg-[#1B2A4A] text-white',
  manual: 'bg-[#C5A55A]/20 text-[#8B7340]',
  system: 'bg-gray-100 text-gray-700',
  webhook: 'bg-purple-100 text-purple-800',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };

    Promise.all([
      fetch('/api/dashboard', opts).then((r) => {
        if (!r.ok) throw new Error(`Failed to load dashboard (${r.status})`);
        return r.json() as Promise<DashboardData>;
      }),
      fetch('/api/dashboard/activity?limit=10', opts).then((r) => {
        if (!r.ok) throw new Error(`Failed to load activity (${r.status})`);
        return r.json() as Promise<{ activity: ActivityEntry[] }>;
      }),
    ])
      .then(([dashData, actData]) => {
        setData(dashData);
        setActivity(actData.activity);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">Operations command center</p>
      </div>

      {error ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">
            Check your connection and try refreshing.
          </p>
        </div>
      ) : (
        <>
          {/* ── Row 1: Key Metrics ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
            ) : data ? (
              <>
                <MetricCard
                  label="Total Orders"
                  value={data.stats.totalOrders.toLocaleString()}
                  accent="bg-[#1B2A4A]"
                />
                <MetricCard
                  label="Open Orders"
                  value={data.stats.openOrders.toLocaleString()}
                  accent="bg-blue-500"
                />
                <MetricCard
                  label="Closed This Month"
                  value={data.stats.closedThisMonth.toLocaleString()}
                  accent="bg-green-500"
                />
                <SyncCard lastSyncAt={data.stats.lastSyncAt} />
              </>
            ) : null}
          </div>

          {/* ── Row 2: Activity Feed + System Health ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            {/* Left — Activity Feed (3 cols) */}
            <div className="lg:col-span-3">
              <ActivityFeed
                entries={activity}
                loading={loading}
              />
            </div>

            {/* Right — System Health (2 cols) */}
            <div className="lg:col-span-2">
              <SystemHealthPanel
                health={data?.systemHealth ?? null}
                webhooks={data?.webhooks ?? null}
                loading={loading}
              />
            </div>
          </div>

          {/* ── Row 3: Recent Orders ───────────────────────────────────── */}
          <RecentOrdersTable
            orders={data?.recentOrders ?? []}
            loading={loading}
            onNavigate={(id) => router.push(`/orders/${id}`)}
          />
        </>
      )}
    </div>
  );
}

// ─── Row 1: Metric Cards ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${accent}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">
        {label}
      </p>
      <p className="text-2xl font-semibold text-[#1A1A2E] mt-1">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  );
}

function SyncCard({ lastSyncAt }: { lastSyncAt: string | null }) {
  const { color, dotClass, relText, fullText } = getSyncHealth(lastSyncAt);
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">
        Last Sync
      </p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <p className="text-2xl font-semibold text-[#1A1A2E]">{relText}</p>
      </div>
      {fullText && <p className="text-xs text-[#6B7280] mt-1">{fullText}</p>}
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded" />
      <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
    </div>
  );
}

// ─── Row 2 Left: Activity Feed ──────────────────────────────────────────────

function ActivityFeed({
  entries,
  loading,
}: {
  entries: ActivityEntry[] | null;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-[#1A1A2E]">Recent Activity</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-3 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : entries && entries.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {entries.map((e) => (
              <Link
                key={e.id}
                href={`/orders/${e.orderId}`}
                className="block px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#1A1A2E]">
                      <span className="font-semibold text-[#1B2A4A]">{e.fileNumber}</span>
                      {' '}changed to{' '}
                      <StatusBadge status={e.status} />
                    </p>
                    {e.notes && (
                      <p className="text-xs text-[#6B7280] mt-0.5 truncate">{e.notes}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <SourceBadge source={e.source} />
                    <p className="text-xs text-[#6B7280] mt-1 whitespace-nowrap">
                      {formatRelative(e.changedAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-sm text-[#6B7280]">No status changes recorded yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Row 2 Right: System Health ─────────────────────────────────────────────

function SystemHealthPanel({
  health,
  webhooks,
  loading,
}: {
  health: SystemHealth | null;
  webhooks: WebhookStats | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 h-full animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
              <div className="h-5 w-28 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const syncStatus = health?.lastSync;
  const syncOk = syncStatus?.status === 'completed';
  const hasFailed = (webhooks?.failedToday ?? 0) > 0;
  const hasAttachFail = (health?.documentAttachFailuresToday ?? 0) > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-[#1A1A2E]">System Health</h2>
      </div>
      <div className="flex-1 px-5 py-4 space-y-5">
        {/* SoftPro Sync */}
        <HealthRow
          label="SoftPro Sync"
          status={syncStatus ? (syncOk ? 'ok' : 'error') : 'unknown'}
          value={
            syncStatus?.endedAt
              ? formatRelative(syncStatus.endedAt)
              : syncStatus?.startedAt
                ? 'Running…'
                : 'Never run'
          }
          sub={
            syncStatus && !syncOk && syncStatus.error
              ? syncStatus.error.slice(0, 80)
              : syncStatus?.endedAt
                ? formatDateTime(syncStatus.endedAt)
                : undefined
          }
        />

        {/* Webhooks */}
        <HealthRow
          label="Webhooks"
          status={hasFailed ? 'warning' : 'ok'}
          value={`${webhooks?.todayCount ?? 0} received today`}
          sub={
            hasFailed
              ? `${webhooks!.failedToday} failed`
              : webhooks?.latestAt
                ? `Latest: ${formatRelative(webhooks.latestAt)}`
                : undefined
          }
          href="/jobs?tab=webhooks"
        />

        {/* Failed Jobs */}
        <HealthRow
          label="Failed Jobs"
          status={(health?.failedJobs ?? 0) > 0 ? 'error' : 'ok'}
          value={
            (health?.failedJobs ?? 0) > 0
              ? `${health!.failedJobs} need attention`
              : 'None'
          }
          href={(health?.failedJobs ?? 0) > 0 ? '/jobs?tab=jobs&jStatus=failed' : undefined}
        />

        {/* Document Pipeline */}
        <HealthRow
          label="Documents"
          status={hasAttachFail ? 'warning' : 'ok'}
          value={`${health?.documentsUploadedToday ?? 0} uploaded today`}
          sub={
            hasAttachFail
              ? `${health!.documentAttachFailuresToday} attach failures`
              : undefined
          }
        />
      </div>
    </div>
  );
}

function HealthRow({
  label,
  status,
  value,
  sub,
  href,
}: {
  label: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  value: string;
  sub?: string;
  href?: string;
}) {
  const dotColor = {
    ok: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    unknown: 'bg-gray-400',
  }[status];

  const inner = (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">{label}</p>
        <p className="text-sm font-medium text-[#1A1A2E] mt-0.5">{value}</p>
        {sub && (
          <p className={`text-xs mt-0.5 ${status === 'error' || status === 'warning' ? 'text-red-600' : 'text-[#6B7280]'}`}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block -mx-2 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors">
        {inner}
      </Link>
    );
  }
  return <div>{inner}</div>;
}

// ─── Row 3: Recent Orders ───────────────────────────────────────────────────

function RecentOrdersTable({
  orders: orderList,
  loading,
  onNavigate,
}: {
  orders: RecentOrder[];
  loading: boolean;
  onNavigate: (id: number) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-[#1A1A2E]">Recent Orders</h2>
        <Link
          href="/orders"
          className="text-sm font-medium text-[#C5A55A] hover:text-[#b3923e] transition-colors"
        >
          View all &rarr;
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">File #</th>
              <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Address</th>
              <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Status</th>
              <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Opened</th>
              <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Closed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <OrderSkeletonRow key={i} />)
              : orderList.length > 0
                ? orderList.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onNavigate(order.id)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">
                        {order.fileNumber}
                      </td>
                      <td className="px-5 py-3 text-[#1A1A2E] max-w-xs truncate">
                        {formatAddress(order.property)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <StatusBadge status={order.operationalStatus} />
                      </td>
                      <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">
                        {formatDate(order.openedAt)}
                      </td>
                      <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">
                        {order.closedAt ? formatDate(order.closedAt) : '—'}
                      </td>
                    </tr>
                  ))
                : null}
          </tbody>
        </table>

        {!loading && orderList.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-[#1A1A2E] font-medium">No orders yet</p>
            <p className="text-sm text-[#6B7280] mt-1">
              Orders will appear here after the first SoftPro sync.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderSkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-5 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-gray-100 text-gray-600';
  const labels: Record<string, string> = {
    softpro_sync: 'Sync',
    manual: 'Manual',
    system: 'System',
    webhook: 'Webhook',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${color}`}>
      {labels[source] ?? source}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSyncHealth(lastSyncAt: string | null) {
  if (!lastSyncAt) {
    return {
      color: 'bg-red-500',
      dotClass: 'bg-red-500',
      relText: 'Never',
      fullText: undefined,
    };
  }

  const diffMs = Date.now() - new Date(lastSyncAt).getTime();
  const hours = diffMs / 3_600_000;

  let color: string;
  let dotClass: string;

  if (hours < 1) {
    color = 'bg-green-500';
    dotClass = 'bg-green-500';
  } else if (hours < 24) {
    color = 'bg-amber-500';
    dotClass = 'bg-amber-500';
  } else {
    color = 'bg-red-500';
    dotClass = 'bg-red-500 animate-pulse';
  }

  return {
    color,
    dotClass,
    relText: formatRelative(lastSyncAt),
    fullText: formatDateTime(lastSyncAt),
  };
}

function formatAddress(
  property: { address: string | null; city: string | null; state: string | null } | null,
): string {
  if (!property) return '—';
  const parts = [property.address, property.city, property.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
