'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/client/empty-state';
import { formatDate, getStatusStyle } from '@/components/client/order-detail/helpers';
import { OrdersHubTable } from '@/components/shared/orders-hub-table';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';

interface Order {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  openedAt: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface Profile {
  displayName: string;
  email: string;
}

export default function ClientDashboardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  const fetchData = useCallback(() => {
    Promise.all([
      fetch('/api/client/orders?page=1&pageSize=12').then((r) => r.ok ? r.json() : null),
      fetch('/api/client/profile').then((r) => r.ok ? r.json() : null),
    ])
      .then(([orderData, prof]) => {
        if (orderData) setOrders(orderData.orders ?? []);
        if (prof) setProfile(prof);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const firstName = profile?.displayName?.split(' ')[0] ?? 'there';
  const activeCount = orders.filter((o) => o.operationalStatus === 'open' || o.operationalStatus === 'in_process').length;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#1B2A4A] mb-1">
            Welcome back, {firstName}
          </h1>
          <p className="text-[#4B5563]">
            You have {activeCount} active {activeCount === 1 ? 'file' : 'files'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/client/orders"
            className="px-4 py-2.5 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 transition-colors h-11 inline-flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload Document
          </Link>
          <Link
            href="/client/orders/new"
            className="px-4 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors h-11 inline-flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Open New Order
          </Link>
        </div>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <EmptyState type="no-files" />
        </div>
      ) : (
        <>
          {/* File Cards Grid */}
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-[#1B2A4A] mb-6">Your Files</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {orders.map((o) => (
                <FileCard key={o.id} order={o} />
              ))}
            </div>
          </section>

          {/* All Orders — full action table */}
          <section>
            <h2 className="text-lg font-semibold text-[#1B2A4A] mb-6">All Files</h2>
            <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
              <OrdersHubTable
                fetchUrl="/api/client/orders"
                actions={['cpl', 'proposed', 'prelim', 'detail', 'fees']}
                isClient
                accentColor="#F26B2B"
                showSearch
                showStatusFilter
                pageSize={15}
                feesHrefBuilder={(id) => `/client/orders/${id}/fees`}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ─── File Card ────────────────────────────────────────────────────────────── */

function FileCard({ order }: { order: Order }) {
  const addr = formatOrderAddress(order);
  const status = getStatusStyle(order.operationalStatus);

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm hover:shadow-md transition-shadow p-6">
      <div className="flex items-start justify-between mb-4">
        <span className="font-mono text-sm text-[#4B5563] tracking-wide">{order.fileNumber}</span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${status.className}`}>
          {status.label}
        </span>
      </div>

      <div className="mb-4">
        {addr !== '—' ? (
          <h3 className="text-lg font-semibold text-[#1B2A4A] leading-snug">{addr}</h3>
        ) : (
          <p className="text-base text-[#4B5563] italic">Property details pending</p>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm text-[#4B5563] mb-6">
        {order.transactionType && <span className="capitalize">{order.transactionType.replace(/_/g, ' ')}</span>}
        {order.transactionType && order.openedAt && <span className="w-1 h-1 rounded-full bg-[#D1D5DB]" />}
        {order.openedAt && <span>Opened {formatDate(order.openedAt)}</span>}
      </div>

      <div className="flex items-center gap-1 pt-4 border-t border-[#E5E7EB] flex-wrap">
        {[
          { label: 'View', href: `/client/orders/${order.id}`, icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
          { label: 'Docs', href: `/client/orders/${order.id}?tab=documents`, icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
          { label: 'CPL', href: `/client/orders/${order.id}/cpl`, icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
          { label: 'Prelim', href: `/client/orders/${order.id}/prelim`, icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
          { label: 'Fees', href: `/client/orders/${order.id}/fees`, icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
        ].map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#4B5563] rounded-lg hover:bg-[#F3F4F6] hover:text-[#1B2A4A] transition-colors min-h-[40px]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={a.icon} />
            </svg>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ─── Skeleton ─────────────────────────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#E5E7EB] p-6 animate-pulse">
            <div className="flex justify-between mb-4">
              <div className="h-4 w-32 bg-gray-100 rounded" />
              <div className="h-5 w-16 bg-gray-100 rounded-full" />
            </div>
            <div className="h-6 bg-gray-100 rounded w-3/4 mb-4" />
            <div className="h-4 bg-gray-100 rounded w-1/2 mb-6" />
            <div className="h-px bg-gray-100 mb-4" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((__, j) => <div key={j} className="h-8 w-14 bg-gray-100 rounded" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
