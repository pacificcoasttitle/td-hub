'use client';

import { useEffect, useState } from 'react';
import {
  type OrderDetail,
  StatusBadge,
  PropertySection,
  TransactionSection,
  PartiesSection,
  AssignmentsSection,
  DocumentsSection,
  StatusHistorySection,
  DetailSkeleton,
} from './order-detail-sections';

interface Props {
  orderId: number;
  fileNumber: string;
  open: boolean;
  onClose: () => void;
}

export function OrderDetailsModal({ orderId, fileNumber, open, onClose }: Props) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setData(null); setError(null); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/orders/${orderId}/detail`, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [open, orderId]);

  if (!open) return null;

  const status = data?.order.status;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#1A1A2E]">Order #{fileNumber}</h2>
            {status && <StatusBadge status={status} />}
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1" style={{ maxHeight: '80vh' }}>
          {loading && <DetailSkeleton />}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-600 font-medium">Failed to load order details</p>
              <p className="text-sm text-[#6B7280] mt-1">Order ID: {orderId}</p>
            </div>
          )}

          {!loading && !error && data && (
            <>
              <PropertySection property={data.property} />
              <TransactionSection order={data.order} />
              <PartiesSection parties={data.parties} />
              <AssignmentsSection assignments={data.assignments} />
              <DocumentsSection documents={data.documents} />
              <StatusHistorySection history={data.statusHistory} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
