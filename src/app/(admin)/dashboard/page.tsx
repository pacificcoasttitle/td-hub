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

interface RecentOrder {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  openedAt: string;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

interface DashboardData {
  stats: DashboardStats;
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

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dashboard', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
        return res.json() as Promise<DashboardData>;
      })
      .then(setData)
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
        <p className="text-sm text-[#6B7280] mt-1">Operational overview</p>
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
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : data ? (
              <>
                <StatCard
                  label="Total Orders"
                  value={data.stats.totalOrders.toLocaleString()}
                  accent="bg-[#1B2A4A]"
                />
                <StatCard
                  label="Open Orders"
                  value={data.stats.openOrders.toLocaleString()}
                  accent="bg-blue-500"
                />
                <StatCard
                  label="Closed This Month"
                  value={data.stats.closedThisMonth.toLocaleString()}
                  accent="bg-green-500"
                />
                <StatCard
                  label="Last Sync"
                  value={
                    data.stats.lastSyncAt
                      ? formatRelative(data.stats.lastSyncAt)
                      : 'Never'
                  }
                  sub={
                    data.stats.lastSyncAt
                      ? formatDateTime(data.stats.lastSyncAt)
                      : undefined
                  }
                  accent="bg-[#C5A55A]"
                />
              </>
            ) : null}
          </div>

          {/* Recent Orders */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-[#1A1A2E]">
                Recent Orders
              </h2>
              <Link
                href="/orders"
                className="text-sm font-medium text-[#C5A55A] hover:text-[#b3923e] transition-colors"
              >
                View all →
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">
                      File #
                    </th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">
                      Address
                    </th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">
                      Status
                    </th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">
                      Opened
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <SkeletonRow key={i} />
                      ))
                    : data && data.recentOrders.length > 0
                      ? data.recentOrders.map((order) => (
                          <tr
                            key={order.id}
                            onClick={() => router.push(`/orders/${order.id}`)}
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
                          </tr>
                        ))
                      : null}
                </tbody>
              </table>

              {!loading && data && data.recentOrders.length === 0 && (
                <div className="p-8 text-center">
                  <p className="text-[#1A1A2E] font-medium">No orders yet</p>
                  <p className="text-sm text-[#6B7280] mt-1">
                    Orders will appear here after the first SoftPro sync.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
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

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded" />
      <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 4 }).map((_, i) => (
        <td key={i} className="px-5 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
