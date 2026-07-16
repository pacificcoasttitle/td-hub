'use client';

import Link from 'next/link';
import { formatOrderDate, formatOrderDateTime } from '@/lib/domain/orders/date-format';
import { statusBadge } from '@/lib/domain/orders/status-format';

// ─── Constants ──────────────────────────────────────────────────────────────

export const SOURCE_COLORS: Record<string, string> = {
  softpro_sync: 'bg-[#1B2A4A] text-white',
  manual: 'bg-[#C5A55A]/20 text-[#8B7340]',
  system: 'bg-gray-100 text-gray-700',
  webhook: 'bg-purple-100 text-purple-800',
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecentOrder {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  openedAt: string;
  closedAt: string | null;
  transactionType?: string | null;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

export interface ActivityEntry {
  id: number;
  orderId: number;
  fileNumber: string;
  status: string;
  source: string;
  notes: string | null;
  changedAt: string;
}

// ─── Primitives ─────────────────────────────────────────────────────────────

export function MetricCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 relative overflow-hidden h-full">
      <div className={`absolute top-0 left-0 w-1 h-full ${accent}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">{label}</p>
      <p className="text-2xl font-semibold text-[#1A1A2E] mt-1">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded" />
      <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const badge = statusBadge(status);
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}>
      {badge.label}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-gray-100 text-gray-600';
  const labels: Record<string, string> = { softpro_sync: 'Sync', manual: 'Manual', system: 'System', webhook: 'Webhook' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${color}`}>
      {labels[source] ?? source}
    </span>
  );
}

export function SectionCard({
  title, action, children, className,
}: {
  title: string; action?: { label: string; href: string }; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-[#1A1A2E]">{title}</h2>
        {action && (
          <Link href={action.href} className="text-sm font-medium text-[#C5A55A] hover:text-[#b3923e] transition-colors">
            {action.label}
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function ActivityList({ entries, loading }: { entries: ActivityEntry[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-5 py-3 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No recent activity.</p></div>;
  }
  return (
    <div className="divide-y divide-gray-100">
      {entries.map((e) => (
        <Link key={e.id} href={`/orders/${e.orderId}`} className="block px-5 py-3 hover:bg-gray-50 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[#1A1A2E]">
                <span className="font-semibold text-[#1B2A4A]">{e.fileNumber}</span>
                {' '}changed to <StatusBadge status={e.status} />
              </p>
              {e.notes && <p className="text-xs text-[#6B7280] mt-0.5 truncate">{e.notes}</p>}
            </div>
            <div className="flex-shrink-0 text-right">
              <SourceBadge source={e.source} />
              <p className="text-xs text-[#6B7280] mt-1 whitespace-nowrap">{formatRelative(e.changedAt)}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function OrdersTable({
  orders, loading, columns, onNavigate, emptyMessage,
}: {
  orders: RecentOrder[];
  loading: boolean;
  columns: { key: string; label: string; render: (o: RecentOrder) => React.ReactNode }[];
  onNavigate: (id: number) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            {columns.map((c) => (
              <th key={c.key} className="text-left px-5 py-2.5 font-medium text-[#6B7280]">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{columns.map((c) => (
                  <td key={c.key} className="px-5 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                ))}</tr>
              ))
            : orders.length > 0
              ? orders.map((o) => (
                  <tr key={o.id} onClick={() => onNavigate(o.id)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    {columns.map((c) => <td key={c.key} className="px-5 py-3">{c.render(o)}</td>)}
                  </tr>
                ))
              : null}
        </tbody>
      </table>
      {!loading && orders.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-sm text-[#6B7280]">{emptyMessage ?? 'No orders found.'}</p>
        </div>
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
      <p className="text-red-600 font-medium">{message}</p>
      <p className="text-sm text-[#6B7280] mt-1">Check your connection and try refreshing.</p>
    </div>
  );
}

// ─── Shared Column Definitions ──────────────────────────────────────────────

export const BASE_ORDER_COLUMNS = [
  { key: 'file', label: 'File #', render: (o: RecentOrder) => <span className="font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</span> },
  { key: 'address', label: 'Address', render: (o: RecentOrder) => <span className="text-[#1A1A2E] max-w-xs truncate block">{formatAddress(o.property)}</span> },
  { key: 'status', label: 'Status', render: (o: RecentOrder) => <StatusBadge status={o.operationalStatus} /> },
  { key: 'type', label: 'Type', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap capitalize">{o.transactionType ?? '—'}</span> },
  { key: 'opened', label: 'Opened', render: (o: RecentOrder) => <span className="text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</span> },
];

// ─── Formatters ─────────────────────────────────────────────────────────────

export function formatAddress(property: { address: string | null; city: string | null; state: string | null } | null | undefined): string {
  if (!property) return '—';
  const parts = [property.address, property.city, property.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function formatDate(iso: string | null): string {
  return formatOrderDate(iso);
}

export function formatDateTime(iso: string): string {
  return formatOrderDateTime(iso);
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
