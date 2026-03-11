'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Document {
  id: number;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface OrderDetail {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  openedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    county: string | null;
    fullAddress: string | null;
  } | null;
  documents: Document[];
}

type Tab = 'Overview' | 'Property' | 'Documents';
const TABS: Tab[] = ['Overview', 'Property', 'Documents'];

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_process: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  canceled: 'bg-red-50 text-red-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  cpl: 'CPL',
  prelim: 'Prelim',
  policy: 'Policy',
  legal_vesting: 'Legal Vesting',
  grant_deed: 'Grant Deed',
  tax: 'Tax',
  general: 'General',
  user_upload: 'Upload',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ClientOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/client/orders/${params.id}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : Promise.reject('Order not found'))
      .then((d) => setOrder(d))
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(typeof err === 'string' ? err : 'Failed to load order');
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [params.id]);

  if (loading) {
    return (
      <div>
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="h-8 w-64 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-8" />
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${40 + Math.random() * 50}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div>
        <Link href="/client/orders" className="text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors">
          ← Back to orders
        </Link>
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-[#1A1A2E] font-medium">{error ?? 'Order not found'}</p>
          <Link href="/client/orders" className="text-sm text-[#1B2A4A] hover:underline mt-2 inline-block">
            Return to order list
          </Link>
        </div>
      </div>
    );
  }

  const addr = [order.property?.address, order.property?.city, order.property?.state].filter(Boolean).join(', ');
  const statusStyle = STATUS_STYLES[order.operationalStatus] ?? 'bg-gray-50 text-gray-600';

  return (
    <div>
      {/* Back */}
      <Link
        href="/client/orders"
        className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-6"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to orders
      </Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">{order.fileNumber}</h1>
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyle}`}>
            {order.operationalStatus.replace(/_/g, ' ')}
          </span>
        </div>
        {addr && <p className="text-sm text-[#6B7280]">{addr}</p>}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === tab ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1B2A4A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg border border-gray-200">
        {activeTab === 'Overview' && <OverviewTab order={order} />}
        {activeTab === 'Property' && <PropertyTab property={order.property} />}
        {activeTab === 'Documents' && <DocumentsTab documents={order.documents} />}
      </div>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

function OverviewTab({ order }: { order: OrderDetail }) {
  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-[#1A1A2E] mb-4">Order Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-8">
        <Field label="File Number" value={order.fileNumber} />
        <Field label="Status" value={order.operationalStatus.replace(/_/g, ' ')} capitalize />
        <Field label="Transaction Type" value={order.transactionType} />
        <Field label="Opened" value={formatDate(order.openedAt)} />
        <Field label="Completed" value={formatDate(order.completedAt)} />
        <Field label="Closed" value={formatDate(order.closedAt)} />
      </div>
    </div>
  );
}

// ─── Property ───────────────────────────────────────────────────────────────

function PropertyTab({ property }: { property: OrderDetail['property'] }) {
  if (!property) {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-[#6B7280] text-sm">No property information available.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-[#1A1A2E] mb-4">Property Details</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-8">
        <Field label="Address" value={property.address} />
        <Field label="City" value={property.city} />
        <Field label="State" value={property.state} />
        <Field label="County" value={property.county} />
        {property.fullAddress && (
          <div className="sm:col-span-2">
            <Field label="Full Address" value={property.fullAddress} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Documents ──────────────────────────────────────────────────────────────

function DocumentsTab({ documents }: { documents: Document[] }) {
  if (documents.length === 0) {
    return (
      <div className="p-6 text-center py-12">
        <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-[#6B7280]">No documents available for this order.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Document</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Category</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Size</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Date</th>
            <th className="px-5 py-3 text-right text-xs font-medium text-[#6B7280] uppercase tracking-wider" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {documents.map((doc) => (
            <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="font-medium text-[#1A1A2E] truncate max-w-xs">{doc.filename}</span>
                </div>
              </td>
              <td className="px-5 py-4">
                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">
                  {CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}
                </span>
              </td>
              <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatFileSize(doc.sizeBytes)}</td>
              <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
              <td className="px-5 py-4 text-right">
                <a
                  href={`/api/documents/${doc.id}/download`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#1B2A4A] hover:underline"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function Field({ label, value, capitalize: cap }: { label: string; value: string | null | undefined; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#6B7280] mb-0.5">{label}</p>
      <p className={`text-sm text-[#1A1A2E] ${cap ? 'capitalize' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
