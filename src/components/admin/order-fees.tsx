'use client';

import { useEffect, useState } from 'react';

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
}

export default function OrderFees({ orderId }: { orderId: number }) {
  const [data, setData] = useState<FeesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/orders/${orderId}/fees`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load fees (${r.status})`);
        return r.json() as Promise<FeesResponse>;
      })
      .then(setData)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [orderId]);

  if (loading) return <FeesSkeleton />;

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600 font-medium">{error}</p>
        <p className="text-xs text-[#6B7280] mt-1">Fee data could not be loaded from SoftPro.</p>
      </div>
    );
  }

  if (!data || data.invoices.length === 0) {
    return (
      <div className="p-8 text-center">
        <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-[#6B7280]">No fees available for this order.</p>
      </div>
    );
  }

  const multipleInvoices = data.invoices.length > 1;

  return (
    <div className="p-6">
      {data.invoices.map((inv) => (
        <div key={inv.id} className={multipleInvoices ? 'mb-6 last:mb-0' : ''}>
          {multipleInvoices && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">{inv.label}</h3>
          )}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Description</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#6B7280] w-32">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inv.items.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 text-[#1A1A2E]">{item.description}</td>
                    <td className="px-4 py-2.5 text-right text-[#1A1A2E] tabular-nums">{fmt(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50/60 border-t border-gray-200">
                  <td className="px-4 py-3 font-semibold text-[#1A1A2E]">{multipleInvoices ? 'Subtotal' : 'Total'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#1A1A2E] tabular-nums">{fmt(inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}

      {multipleInvoices && (
        <div className="mt-4 bg-[#1B2A4A]/5 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#1B2A4A]">Grand Total</span>
          <span className="text-lg font-bold text-[#1B2A4A] tabular-nums">{fmt(data.grandTotal)}</span>
        </div>
      )}

      <p className="text-xs text-[#9CA3AF] mt-4">Fee data from SoftPro</p>
    </div>
  );
}

function FeesSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50/60 border-b border-gray-200 px-4 py-2.5 flex justify-between">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-16 bg-gray-200 rounded" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-2.5 flex justify-between border-b border-gray-100">
            <div className="h-4 bg-gray-200 rounded" style={{ width: `${30 + Math.random() * 40}%` }} />
            <div className="h-4 w-16 bg-gray-200 rounded" />
          </div>
        ))}
        <div className="bg-gray-50/60 px-4 py-3 flex justify-between">
          <div className="h-4 w-12 bg-gray-200 rounded" />
          <div className="h-4 w-20 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
