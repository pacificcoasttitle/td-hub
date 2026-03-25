'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  OrderConfirmation,
  hasProcessingDocs,
  type ConfirmationData,
} from '@/components/hub/OrderConfirmation';

const POLL_INTERVAL = 10_000;

export default function OrderConfirmPage() {
  const { fileNumber } = useParams<{ fileNumber: string }>();
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (fn: string, isInitial: boolean) => {
    try {
      const res = await fetch(`/api/orders/confirm/${encodeURIComponent(fn)}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'Order not found.' : 'Failed to load confirmation.');
      const json: ConfirmationData = await res.json();
      setData(json);
      return json;
    } catch (err) {
      if (isInitial) setError(err instanceof Error ? err.message : 'Failed to load confirmation.');
      return null;
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fileNumber) return;
    let cancelled = false;

    (async () => {
      const result = await fetchData(fileNumber, true);
      if (cancelled || !result) return;

      if (hasProcessingDocs(result)) {
        pollRef.current = setInterval(async () => {
          const updated = await fetchData(fileNumber, false);
          if (!updated || !hasProcessingDocs(updated)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, POLL_INTERVAL);
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fileNumber, fetchData]);

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
