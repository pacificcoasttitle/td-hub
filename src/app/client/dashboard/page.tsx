'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

interface DashboardData {
  orders: Order[];
  total: number;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_process: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  canceled: 'bg-red-50 text-red-700',
};

const ACTIONS = [
  {
    label: 'Open New Order',
    sub: 'Start a title or escrow order',
    href: '/client/orders/new',
    icon: 'M12 4v16m8-8H4',
  },
  {
    label: 'My Orders',
    sub: 'View all your orders',
    href: '/client/orders',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    label: 'Fee Estimates',
    sub: 'View fees for your orders',
    href: '/client/orders',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    label: 'Review Prelim',
    sub: 'Check your preliminary report',
    href: '/client/orders',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    label: 'My Documents',
    sub: 'Download order documents',
    href: '/client/orders',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  },
];

export default function ClientDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    fetch('/api/client/orders?page=1&pageSize=8')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="px-1 sm:px-0">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E]">Welcome back</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">Manage your title and escrow transactions</p>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {ACTIONS.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="bg-[#1B2A4A] rounded-xl p-4 sm:p-5 hover:bg-[#243658] transition-colors group min-h-[100px] flex flex-col justify-between"
          >
            <svg className="h-6 w-6 text-white/60 group-hover:text-white/80 transition-colors mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={a.icon} />
            </svg>
            <div>
              <p className="text-sm font-semibold text-white">{a.label}</p>
              <p className="text-xs text-white/50 mt-0.5 hidden sm:block">{a.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-[#1A1A2E]">Recent Orders</h2>
          <Link href="/client/orders" className="text-sm font-medium text-[#1B2A4A] hover:underline">
            View all →
          </Link>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">File #</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Address</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 4 }).map((__, j) => (
                  <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} /></td>
                ))}</tr>
              ))}
              {data?.orders.map((o) => {
                const addr = [o.address, o.city, o.state].filter(Boolean).join(', ');
                return (
                  <tr key={o.id} onClick={() => router.push(`/client/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-4 font-medium text-[#1A1A2E] whitespace-nowrap">{o.fileNumber}</td>
                    <td className="px-5 py-4 text-[#374151] max-w-xs truncate">{addr || '—'}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[o.operationalStatus] ?? 'bg-gray-50 text-gray-600'}`}>
                        {o.operationalStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatDate(o.openedAt)}</td>
                  </tr>
                );
              })}
              {data && data.orders.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-[#6B7280]">No orders yet. Open your first order above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="sm:hidden divide-y divide-gray-100">
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 animate-pulse"><div className="h-4 bg-gray-100 rounded w-1/2 mb-2" /><div className="h-3 bg-gray-100 rounded w-3/4" /></div>
          ))}
          {data?.orders.map((o) => {
            const addr = [o.address, o.city, o.state].filter(Boolean).join(', ');
            return (
              <Link key={o.id} href={`/client/orders/${o.id}`} className="block p-4 hover:bg-gray-50 transition-colors min-h-[60px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A2E]">{o.fileNumber}</p>
                    <p className="text-xs text-[#6B7280] truncate">{addr || '—'}</p>
                  </div>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize flex-shrink-0 ${STATUS_STYLES[o.operationalStatus] ?? 'bg-gray-50 text-gray-600'}`}>
                    {o.operationalStatus.replace(/_/g, ' ')}
                  </span>
                </div>
              </Link>
            );
          })}
          {data && data.orders.length === 0 && (
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No orders yet.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
