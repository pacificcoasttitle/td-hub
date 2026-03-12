'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { OrderTimeline } from '@/components/client/order-timeline';

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

type Tab = 'Timeline' | 'Property' | 'Documents';
const TABS: Tab[] = ['Timeline', 'Property', 'Documents'];

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

function getStatusBanner(status: string): { label: string; bg: string; text: string; icon: string } {
  const isComplete = status === 'completed' || status === 'closed';
  return {
    label: isComplete ? 'Your order is COMPLETE' : 'Your order is IN PROGRESS',
    bg: isComplete ? 'bg-[#1B2A4A]' : 'bg-white border border-[#1B2A4A]',
    text: isComplete ? 'text-white' : 'text-[#1B2A4A]',
    icon: isComplete
      ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
      : 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ClientOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Timeline');

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
      <div className="px-1 sm:px-0">
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
      <div className="px-1 sm:px-0">
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
  const banner = getStatusBanner(order.operationalStatus);

  return (
    <div className="px-1 sm:px-0">
      {/* Back */}
      <Link
        href="/client/orders"
        className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-4 sm:mb-6 min-h-[44px] sm:min-h-0"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to orders
      </Link>

      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E]">{order.fileNumber}</h1>
        {addr && <p className="text-sm text-[#6B7280] mt-0.5">{addr}</p>}
      </div>

      {/* Status Banner */}
      <div className={`rounded-lg px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 mb-5 sm:mb-6 ${banner.bg}`}>
        <svg className={`h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0 ${banner.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={banner.icon} />
        </svg>
        <p className={`text-sm sm:text-base font-semibold ${banner.text}`}>{banner.label}</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-5 sm:mb-6 overflow-x-auto">
        <nav className="flex gap-4 sm:gap-6 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative whitespace-nowrap min-h-[44px] sm:min-h-0 ${
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
        {activeTab === 'Timeline' && <OrderTimeline orderId={order.id} />}
        {activeTab === 'Property' && <PropertyTab property={order.property} />}
        {activeTab === 'Documents' && <DocumentsTab documents={order.documents} />}
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
    <>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
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

      {/* Mobile card list */}
      <div className="sm:hidden divide-y divide-gray-100">
        {documents.map((doc) => (
          <div key={doc.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1A1A2E] truncate">{doc.filename}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">
                    {CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}
                  </span>
                  <span className="text-xs text-[#6B7280]">{formatFileSize(doc.sizeBytes)}</span>
                </div>
                <p className="text-xs text-[#6B7280] mt-1">{formatDate(doc.createdAt)}</p>
              </div>
              <a
                href={`/api/documents/${doc.id}/download`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-lg hover:bg-[#1B2A4A]/10 transition-colors min-h-[44px] flex-shrink-0"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
            </div>
          </div>
        ))}
      </div>
    </>
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
