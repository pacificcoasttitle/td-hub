'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { OrderConfirmation, type ConfirmationData } from '@/components/hub/OrderConfirmation';

export default function OrderConfirmPage() {
  const { fileNumber } = useParams<{ fileNumber: string }>();
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileNumber) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orders/confirm/${encodeURIComponent(fileNumber)}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'Order not found.' : 'Failed to load confirmation.');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load confirmation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fileNumber]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Order Confirmation</h1>
        <p className="text-sm text-[#6B7280] mt-1">Your order has been submitted. Review the details below.</p>
      </div>
      <OrderConfirmation data={data} loading={loading} error={error} />
    </div>
  );
}
