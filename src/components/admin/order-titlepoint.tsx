'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TpRequest {
  id: number;
  searchType: string | null;
  status: string | null;
  message: string | null;
  requestId: string | null;
  createdAt: string;
  updatedAt: string;
}

const SEARCH_TYPE_LABELS: Record<string, string> = {
  geo_address: 'Property Search',
  legal_vesting: 'Legal Vesting',
  grant_deed: 'Grant Deed',
  tax: 'Tax',
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-400', label: 'Pending' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500', label: 'Completed' },
  Success: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500', label: 'Completed' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500', label: 'Failed' },
  error: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500', label: 'Error' },
};

export default function OrderTitlePoint({
  orderId,
  fileNumber,
}: {
  orderId: number;
  fileNumber: string;
}) {
  const [requests, setRequests] = useState<TpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/orders/${orderId}/titlepoint`)
      .then((r) => r.ok ? r.json() : Promise.reject('Failed to load'))
      .then((data) => { if (!cancelled) setRequests(data.requests ?? []); })
      .catch((err) => { if (!cancelled) setError(typeof err === 'string' ? err : 'Failed to load TitlePoint requests'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId]);

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-[#1A1A2E]">TitlePoint Requests</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">Property search and document retrieval requests for this order</p>
        </div>
        <Link
          href={`/vendor-actions?tab=titlepoint&orderId=${orderId}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          New Search
        </Link>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="py-10 text-center border border-dashed border-gray-200 rounded-lg">
          <svg className="mx-auto h-8 w-8 text-[#6B7280] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm text-[#6B7280]">No TitlePoint requests for this order yet.</p>
          <Link
            href={`/vendor-actions?tab=titlepoint&orderId=${orderId}`}
            className="text-sm font-medium text-[#C5A55A] hover:underline mt-1 inline-block"
          >
            Start a new search →
          </Link>
        </div>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Message</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {requests.map((r) => {
                const st = STATUS_CONFIG[r.status ?? ''] ?? { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', label: r.status ?? 'Unknown' };
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[#1A1A2E]">
                      {SEARCH_TYPE_LABELS[r.searchType ?? ''] ?? r.searchType ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6B7280] max-w-xs truncate">
                      {r.message || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
