'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { StepSelectOrder, OrderSummaryBanner, SummaryField } from './step-select-order';
import type { OrderResult } from './step-select-order';
import type { TitlePointSearchType as TpSearchType } from '@/lib/integrations/titlepoint/types';
type TpStep = 'order' | 'type' | 'initiate' | 'status';

interface TpRequest {
  id: number;
  status: string | null;
  searchType: string | null;
  message: string | null;
  requestId: string | null;
  createdAt: string;
}

const SEARCH_TYPES: { value: TpSearchType; label: string; description: string }[] = [
  { value: 'geo_address', label: 'Property Search', description: 'Geo/Address — search by property address' },
  { value: 'legal_vesting', label: 'Legal Vesting', description: 'Legal vesting document retrieval' },
  { value: 'grant_deed', label: 'Grant Deed', description: 'Deed image by instrument number' },
  { value: 'tax', label: 'Tax', description: 'Tax document retrieval' },
];

export function TitlePointWizard({ prefilledOrderId }: { prefilledOrderId: string | null }) {
  const [tpStep, setTpStep] = useState<TpStep>('order');
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [searchType, setSearchType] = useState<TpSearchType | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [tpRequest, setTpRequest] = useState<TpRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!prefilledOrderId) return;
    fetch(`/api/orders/${prefilledOrderId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((order) => {
        if (order) {
          setSelectedOrder({ id: order.id, fileNumber: order.fileNumber, operationalStatus: order.operationalStatus, property: order.property });
          setTpStep('type');
        }
      })
      .catch(() => {});
  }, [prefilledOrderId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function handleSelectOrder(order: OrderResult) { setSelectedOrder(order); setTpStep('type'); }
  function handleSelectSearchType(st: TpSearchType) { setSearchType(st); setTpStep('initiate'); }

  async function handleInitiate() {
    if (!selectedOrder || !searchType) return;
    setInitiating(true);
    setError(null);
    try {
      const res = await fetch('/api/vendor-actions/titlepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selectedOrder.id, searchType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setTpRequest(data.request);
      setTpStep('status');
      startPolling(data.request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate search');
    } finally {
      setInitiating(false);
    }
  }

  function startPolling(requestId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/vendor-actions/titlepoint/${requestId}`);
        if (!res.ok) return;
        const data = await res.json();
        setTpRequest(data.request);
        if (data.request.status !== 'pending') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setTpStep('order'); setSelectedOrder(null); setSearchType(null);
    setTpRequest(null); setError(null);
  }

  const tpSteps = [
    { key: 'order', label: 'Order' },
    { key: 'type', label: 'Search Type' },
    { key: 'initiate', label: 'Initiate' },
  ];
  const stepIdx = tpStep === 'status' ? 3 : tpSteps.findIndex((s) => s.key === tpStep);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1 mb-8">
        {tpSteps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <button
              onClick={() => { if (i < stepIdx) setTpStep(s.key as TpStep); }}
              disabled={i > stepIdx}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === stepIdx
                  ? 'bg-[#1B2A4A] text-white'
                  : i < stepIdx
                    ? 'bg-[#C5A55A]/20 text-[#1B2A4A] hover:bg-[#C5A55A]/30 cursor-pointer'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                i < stepIdx ? 'bg-[#C5A55A] text-white' : i === stepIdx ? 'bg-white/20' : ''
              }`}>
                {i < stepIdx ? '✓' : i + 1}
              </span>
              {s.label}
            </button>
            {i < tpSteps.length - 1 && <div className="w-4 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {tpStep === 'order' && <StepSelectOrder onSelect={handleSelectOrder} />}

        {tpStep === 'type' && selectedOrder && (
          <div className="p-6">
            <OrderSummaryBanner order={selectedOrder} />
            <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1 mt-5">Search Type</h3>
            <p className="text-sm text-[#6B7280] mb-4">Select the type of TitlePoint search to perform</p>
            <div className="grid grid-cols-2 gap-3">
              {SEARCH_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => handleSelectSearchType(st.value)}
                  className={`text-left px-4 py-4 rounded-lg border-2 transition-colors ${
                    searchType === st.value ? 'border-[#C5A55A] bg-[#C5A55A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/30'
                  }`}
                >
                  <p className="font-semibold text-[#1A1A2E]">{st.label}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{st.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {tpStep === 'initiate' && selectedOrder && searchType && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Confirm &amp; Start</h3>
            <div className="grid grid-cols-2 gap-4 text-sm mb-6">
              <SummaryField label="Order" value={selectedOrder.fileNumber}
                sub={[selectedOrder.property?.address, selectedOrder.property?.city].filter(Boolean).join(', ') || undefined} />
              <SummaryField label="Search Type" value={SEARCH_TYPES.find((s) => s.value === searchType)?.label ?? searchType} />
            </div>
            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <p className="font-medium">{error}</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button onClick={handleInitiate} disabled={initiating}
                className="px-5 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2">
                {initiating && (
                  <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {initiating ? 'Starting…' : 'Start Search'}
              </button>
              <button onClick={handleReset} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
                Start Over
              </button>
            </div>
          </div>
        )}

        {tpStep === 'status' && tpRequest && (
          <TpStatusCard request={tpRequest} orderId={selectedOrder!.id} onReset={handleReset} onRetry={handleInitiate} />
        )}
      </div>
    </div>
  );
}

function TpStatusCard({
  request, orderId, onReset, onRetry,
}: {
  request: TpRequest; orderId: number; onReset: () => void; onRetry: () => void;
}) {
  const isPending = request.status === 'pending';
  const isSuccess = request.status === 'Success' || request.status === 'completed';
  const isFailed = !isPending && !isSuccess;
  const stLabel = SEARCH_TYPES.find((s) => s.value === request.searchType)?.label ?? request.searchType;

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Search Status</h3>
      <div className={`px-5 py-4 rounded-lg border ${
        isPending ? 'bg-amber-50 border-amber-200' : isSuccess ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-start gap-3">
          {isPending && (
            <svg className="h-5 w-5 text-amber-500 animate-spin shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {isSuccess && (
            <svg className="h-5 w-5 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isFailed && (
            <svg className="h-5 w-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <div className="flex-1">
            <p className={`font-medium text-sm ${isPending ? 'text-amber-800' : isSuccess ? 'text-green-800' : 'text-red-800'}`}>
              {isPending ? 'Searching…' : isSuccess ? 'Results ready' : 'Search failed'}
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              {stLabel}{request.message ? ` — ${request.message}` : ''}
            </p>
            {isPending && <p className="text-xs text-amber-600 mt-2">Polling for results every 5 seconds…</p>}
            {isSuccess && (
              <Link href={`/orders/${orderId}?tab=Documents`} className="text-xs text-green-800 underline mt-2 inline-block">
                View documents →
              </Link>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        {isFailed && (
          <button onClick={onRetry} className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
            Retry
          </button>
        )}
        <button onClick={onReset} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          New Search
        </button>
      </div>
    </div>
  );
}
