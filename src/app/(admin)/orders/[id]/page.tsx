'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
  apn: string | null;
  legalDescription: string | null;
  propertyType: string | null;
  zip: string | null;
}

interface StatusHistoryEntry {
  id: number;
  status: string;
  source: string;
  notes: string | null;
  changedAt: string;
}

interface OrderDetail {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  softproStatus: string | null;
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  source: string;
  openedAt: string;
  completedAt: string | null;
  closedAt: string | null;
  salesPrice: string | null;
  loanAmount: string | null;
  isImported: boolean;
  softproLastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: OrderProperty | null;
  parties: unknown[];
  statusHistory: StatusHistoryEntry[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Property', 'History', 'Documents'] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABELS: Record<string, string> = {
  softpro_sync: 'SoftPro Sync',
  manual: 'Manual',
  system: 'System',
  webhook: 'Webhook',
  manual_entry: 'Manual Entry',
  web_form: 'Web Form',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/orders/${params.id}`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 404) throw new Error('Order not found');
        if (!res.ok) throw new Error(`Failed to load order (${res.status})`);
        return res.json() as Promise<OrderDetail>;
      })
      .then(setOrder)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [params.id]);

  if (loading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="p-6">
        <BackLink />
        <div className="mt-8 bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">
            The order may have been removed or you may not have access.
          </p>
          <button
            onClick={() => router.push('/orders')}
            className="mt-4 px-4 py-2 text-sm bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
          >
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="p-6">
      <BackLink />

      {/* Header */}
      <div className="flex items-start justify-between mt-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-[#1A1A2E]">
              {order.fileNumber}
            </h1>
            <StatusBadge status={order.operationalStatus} />
          </div>
          {order.property?.fullAddress && (
            <p className="text-[#6B7280] mt-1">{order.property.fullAddress}</p>
          )}
        </div>
        {order.softproLastSyncedAt && (
          <p className="text-xs text-[#6B7280]">
            Last synced {formatDateTime(order.softproLastSyncedAt)}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === tab
                  ? 'text-[#1B2A4A]'
                  : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {activeTab === 'Overview' && <OverviewTab order={order} />}
        {activeTab === 'Property' && <PropertyTab property={order.property} />}
        {activeTab === 'History' && (
          <HistoryTab history={order.statusHistory} />
        )}
        {activeTab === 'Documents' && <DocumentsPlaceholder />}
      </div>
    </div>
  );
}

// ─── Tab Panels ─────────────────────────────────────────────────────────────

function OverviewTab({ order }: { order: OrderDetail }) {
  return (
    <div className="p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6">
        {/* Left Column — Order Info */}
        <div className="space-y-5">
          <SectionHeading>Order Details</SectionHeading>
          <FieldRow label="File Number" value={order.fileNumber} />
          <FieldRow label="Status">
            <StatusBadge status={order.operationalStatus} />
          </FieldRow>
          {order.softproStatus && (
            <FieldRow label="SoftPro Status" value={order.softproStatus} />
          )}
          <FieldRow
            label="Transaction Type"
            value={order.transactionType}
          />
          {order.productType && (
            <FieldRow label="Product Type" value={order.productType} />
          )}
          {order.orderType && (
            <FieldRow label="Order Type" value={order.orderType} />
          )}
          <FieldRow
            label="Source"
            value={SOURCE_LABELS[order.source] ?? order.source}
          />
        </div>

        {/* Right Column — Dates & Financials */}
        <div className="space-y-5">
          <SectionHeading>Key Dates</SectionHeading>
          <FieldRow label="Opened" value={formatDate(order.openedAt)} />
          <FieldRow
            label="Completed"
            value={order.completedAt ? formatDate(order.completedAt) : null}
          />
          <FieldRow
            label="Closed"
            value={order.closedAt ? formatDate(order.closedAt) : null}
          />

          <div className="pt-2">
            <SectionHeading>Financials</SectionHeading>
          </div>
          <FieldRow
            label="Sales Price"
            value={order.salesPrice ? formatCurrency(order.salesPrice) : null}
          />
          <FieldRow
            label="Loan Amount"
            value={order.loanAmount ? formatCurrency(order.loanAmount) : null}
          />
        </div>
      </div>
    </div>
  );
}

function PropertyTab({ property }: { property: OrderProperty | null }) {
  if (!property) {
    return (
      <EmptySection message="No property data available for this order." />
    );
  }

  return (
    <div className="p-6 space-y-5">
      <SectionHeading>Property Information</SectionHeading>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-5">
        <FieldRow label="Address" value={property.address} />
        <FieldRow label="City" value={property.city} />
        <FieldRow label="State" value={property.state} />
        <FieldRow label="ZIP" value={property.zip} />
        <FieldRow label="County" value={property.county} />
        <FieldRow label="APN" value={property.apn} />
        <FieldRow label="Property Type" value={property.propertyType} />
        <FieldRow label="Full Address" value={property.fullAddress} />
      </div>
      {property.legalDescription && (
        <div className="pt-2">
          <SectionHeading>Legal Description</SectionHeading>
          <p className="text-sm text-[#1A1A2E] mt-2 leading-relaxed whitespace-pre-wrap">
            {property.legalDescription}
          </p>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ history }: { history: StatusHistoryEntry[] }) {
  if (history.length === 0) {
    return <EmptySection message="No status history recorded for this order." />;
  }

  return (
    <div className="p-6">
      <SectionHeading>Status Timeline</SectionHeading>
      <div className="mt-4 relative">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />

        <ol className="space-y-6">
          {history.map((entry, idx) => (
            <li key={entry.id} className="relative pl-7">
              {/* Dot */}
              <span
                className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-white ${
                  idx === 0 ? 'bg-[#C5A55A]' : 'bg-gray-300'
                }`}
                style={{ boxShadow: '0 0 0 2px #e5e7eb' }}
              />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={entry.status} />
                    <span className="text-xs text-[#6B7280] font-medium">
                      {SOURCE_LABELS[entry.source] ?? entry.source}
                    </span>
                  </div>
                  {entry.notes && (
                    <p className="text-sm text-[#6B7280] mt-1">
                      {entry.notes}
                    </p>
                  )}
                </div>
                <time className="text-xs text-[#6B7280] whitespace-nowrap shrink-0">
                  {formatDateTime(entry.changedAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DocumentsPlaceholder() {
  return (
    <div className="p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
        <svg
          className="h-6 w-6 text-[#6B7280]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <p className="text-[#1A1A2E] font-medium">Document Management</p>
      <p className="text-sm text-[#6B7280] mt-1">
        Coming in Phase 2 — upload, view, and manage order documents.
      </p>
    </div>
  );
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/orders"
      className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1B2A4A] transition-colors"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to Orders
    </Link>
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
      {children}
    </h2>
  );
}

function FieldRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <dt className="w-36 shrink-0 text-sm text-[#6B7280]">{label}</dt>
      <dd className="text-sm text-[#1A1A2E] font-medium">
        {children ?? value ?? <span className="text-[#6B7280] font-normal">—</span>}
      </dd>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="p-12 text-center">
      <p className="text-sm text-[#6B7280]">{message}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-4 w-28 bg-gray-200 rounded" />
      <div className="mt-4 flex items-center gap-3">
        <div className="h-7 w-40 bg-gray-200 rounded" />
        <div className="h-5 w-16 bg-gray-200 rounded-full" />
      </div>
      <div className="h-4 w-64 bg-gray-200 rounded mt-2" />
      <div className="mt-8 flex gap-6 border-b border-gray-200 pb-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 w-20 bg-gray-200 rounded" />
        ))}
      </div>
      <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="grid grid-cols-2 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-4 w-36 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatCurrency(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
