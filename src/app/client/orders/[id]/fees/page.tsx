'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EmptyState } from '@/components/client/empty-state';
import { normalizeClientFeesResponse, type ClientFeesViewData } from '@/lib/domain/orders/client-fees';

const SKELETON_LINE_WIDTHS = ['46%', '68%', '54%', '72%', '39%', '61%'];

export default function ClientFeesPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [data, setData] = useState<ClientFeesViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/client/orders/${orderId}/fees`, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Failed to load fee estimate (${r.status})`);
        return normalizeClientFeesResponse(body);
      })
      .then(setData)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [orderId]);

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={`/client/orders/${orderId}`} className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] transition-colors mb-6 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to order
      </Link>

      <h1 className="text-2xl sm:text-3xl font-semibold text-[#1B2A4A] mb-1">Estimated Fees</h1>
      <p className="text-[#4B5563] mb-8">
        {data?.fileNumber && <><span className="font-mono text-sm">{data.fileNumber}</span> &middot; </>}
        Title and escrow fee breakdown
      </p>

      {loading && <FeesSkeleton />}

      {error && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
          <p className="text-sm text-red-600 font-medium">{error}</p>
          <p className="text-xs text-[#6B7280] mt-1">Please try again later or contact your escrow officer.</p>
        </div>
      )}

      {!loading && !error && data && data.invoices.length === 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <EmptyState type="no-fees" />
        </div>
      )}

      {!loading && !error && data && data.invoices.length > 0 && (
        <>
          {/* Disclaimer */}
          <div className="flex items-start gap-3 p-4 bg-[#FEF3C7] rounded-xl border border-[#FCD34D] mb-6">
            <svg className="h-5 w-5 text-[#D97706] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            <div>
              <p className="font-medium text-[#92400E] text-sm">Fee Estimate Notice</p>
              <p className="text-sm text-[#92400E]/80 mt-1">
                These fees are estimates and may change based on final transaction details. Final fees will be confirmed at closing.
              </p>
            </div>
          </div>

          {data.invoices.map((inv) => {
            const allItems = inv.items;
            return (
              <div key={inv.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-sm mb-6">
                {data.invoices.length > 1 && (
                  <div className="px-6 py-3 border-b border-[#E5E7EB] bg-[#FAFAFA]">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{inv.label}</p>
                  </div>
                )}

                {/* Desktop Table */}
                <div className="hidden sm:block">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#E5E7EB]">
                        <th className="text-left px-6 py-4 text-sm font-medium text-[#4B5563]">Description</th>
                        <th className="text-right px-6 py-4 text-sm font-medium text-[#4B5563]">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allItems.map((fee, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}>
                          <td className="px-6 py-4 text-sm text-[#1B2A4A]">{fee.description}</td>
                          <td className="px-6 py-4 text-sm text-[#1B2A4A] text-right font-mono tabular-nums">{fmt(fee.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <div className="sm:hidden divide-y divide-[#E5E7EB]">
                  {allItems.map((fee, i) => (
                    <div key={i} className={`px-5 py-3.5 flex items-center justify-between gap-3 ${i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                      <span className="text-sm text-[#1B2A4A] min-w-0">{fee.description}</span>
                      <span className="text-sm text-[#1B2A4A] font-medium font-mono tabular-nums flex-shrink-0">{fmt(fee.amount)}</span>
                    </div>
                  ))}
                </div>

                {/* Total Bar */}
                <div className="flex items-center justify-between px-6 py-4 bg-[#1B2A4A]">
                  <span className="font-semibold text-white">{data.invoices.length > 1 ? 'Subtotal' : 'Total Estimated Fees'}</span>
                  <span className="font-bold text-white text-lg font-mono tabular-nums">{fmt(inv.total)}</span>
                </div>
              </div>
            );
          })}

          {data.invoices.length > 1 && (
            <div className="bg-[#1B2A4A] rounded-xl px-6 py-5 flex items-center justify-between">
              <span className="font-semibold text-white">Grand Total</span>
              <span className="text-2xl font-bold text-white font-mono tabular-nums">{fmt(data.grandTotal)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FeesSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden animate-pulse">
      <div className="border-b border-[#E5E7EB] px-6 py-4 flex justify-between">
        <div className="h-4 w-24 bg-gray-100 rounded" />
        <div className="h-4 w-16 bg-gray-100 rounded" />
      </div>
      {SKELETON_LINE_WIDTHS.map((width) => (
        <div key={width} className="px-6 py-4 flex justify-between border-b border-gray-100">
          <div className="h-4 bg-gray-100 rounded" style={{ width }} />
          <div className="h-4 w-20 bg-gray-100 rounded" />
        </div>
      ))}
      <div className="bg-[#1B2A4A] px-6 py-4 flex justify-between">
        <div className="h-4 w-24 bg-white/20 rounded" />
        <div className="h-5 w-28 bg-white/20 rounded" />
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
