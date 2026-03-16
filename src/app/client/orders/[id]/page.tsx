'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { OrderTimeline } from '@/components/client/order-timeline';
import { PropertyTab } from '@/components/client/order-detail/property-tab';
import { DocumentsTab } from '@/components/client/order-detail/documents-tab';
import { getStatusBanner } from '@/components/client/order-detail/helpers';

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
        {activeTab === 'Timeline' && (
          <div>
            <OrderTimeline orderId={order.id} />
            <div className="px-4 sm:px-6 pb-5">
              <Link
                href={`/client/orders/${order.id}/fees`}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#1B2A4A] hover:underline min-h-[44px]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                View Fee Estimate →
              </Link>
            </div>
          </div>
        )}
        {activeTab === 'Property' && <PropertyTab property={order.property} />}
        {activeTab === 'Documents' && <DocumentsTab documents={order.documents} orderId={order.id} />}
      </div>
    </div>
  );
}
