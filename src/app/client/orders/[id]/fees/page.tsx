'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface FeeItem {
  description: string;
  amount: number;
}

interface Invoice {
  id: string | number;
  label: string;
  items: FeeItem[];
  total: number;
}

interface FeesResponse {
  invoices: Invoice[];
  grandTotal: number;
  fileNumber?: string;
}

export default function ClientFeesPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [data, setData] = useState<FeesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/client/orders/${orderId}/fees`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load fee estimate');
        return r.json() as Promise<FeesResponse>;
      })
      .then(setData)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [orderId]);

  return (
    <div className="px-1 sm:px-0">
      <Link
        href={`/client/orders/${orderId}`}
        className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-4 min-h-[44px]"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to order
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E] mb-1">
        Estimated Fees {data?.fileNumber && <span className="text-[#6B7280]">— {data.fileNumber}</span>}
      </h1>
      <p className="text-sm text-[#6B7280] mb-6">Title and escrow fee breakdown for your order</p>

      {loading && <FeesSkeleton />}

      {error && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-red-600 font-medium">{error}</p>
          <p className="text-xs text-[#6B7280] mt-1">Please try again later or contact your escrow officer.</p>
        </div>
      )}

      {!loading && !error && data && data.invoices.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-[#6B7280]">No fee estimate available yet.</p>
          <p className="text-xs text-[#6B7280] mt-1">Fees will appear here once your order has been processed.</p>
        </div>
      )}

      {!loading && !error && data && data.invoices.length > 0 && (
        <>
          {data.invoices.map((inv) => (
            <div key={inv.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
              {data.invoices.length > 1 && (
                <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/60">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{inv.label}</p>
                </div>
              )}
              {/* Desktop */}
              <div className="hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/40">
                      <th className="text-left px-5 py-3 font-medium text-[#6B7280]">Description</th>
                      <th className="text-right px-5 py-3 font-medium text-[#6B7280] w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {inv.items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-5 py-3 text-[#1A1A2E]">{item.description}</td>
                        <td className="px-5 py-3 text-right text-[#1A1A2E] tabular-nums">{fmt(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50/60 border-t border-gray-200">
                      <td className="px-5 py-3 font-semibold text-[#1A1A2E]">{data.invoices.length > 1 ? 'Subtotal' : 'Total'}</td>
                      <td className="px-5 py-3 text-right font-semibold text-[#1A1A2E] tabular-nums">{fmt(inv.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Mobile */}
              <div className="sm:hidden divide-y divide-gray-100">
                {inv.items.map((item, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-[#1A1A2E] min-w-0">{item.description}</span>
                    <span className="text-sm text-[#1A1A2E] font-medium tabular-nums flex-shrink-0">{fmt(item.amount)}</span>
                  </div>
                ))}
                <div className="px-4 py-3 flex items-center justify-between gap-3 bg-gray-50/60">
                  <span className="text-sm font-semibold text-[#1A1A2E]">{data.invoices.length > 1 ? 'Subtotal' : 'Total'}</span>
                  <span className="text-sm font-semibold text-[#1A1A2E] tabular-nums">{fmt(inv.total)}</span>
                </div>
              </div>
            </div>
          ))}

          {data.invoices.length > 1 && (
            <div className="bg-[#1B2A4A] rounded-lg px-5 py-4 flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-white">Estimated Total</span>
              <span className="text-xl font-bold text-white tabular-nums">{fmt(data.grandTotal)}</span>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Disclaimer:</span> These are estimated fees and may change before closing.
              Final fees will be reflected on your closing statement.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function FeesSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
      <div className="border-b border-gray-200 px-5 py-3 flex justify-between">
        <div className="h-4 w-24 bg-gray-100 rounded" />
        <div className="h-4 w-16 bg-gray-100 rounded" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-5 py-3 flex justify-between border-b border-gray-100">
          <div className="h-4 bg-gray-100 rounded" style={{ width: `${30 + Math.random() * 40}%` }} />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
      ))}
      <div className="bg-gray-50/60 px-5 py-3 flex justify-between">
        <div className="h-4 w-12 bg-gray-100 rounded" />
        <div className="h-4 w-20 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
