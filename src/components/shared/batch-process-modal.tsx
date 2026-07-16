'use client';

import { ModalShell } from '@/components/shared/action-modals/modal-shell';
import type { HubOrder } from '@/components/shared/orders-hub-table';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';

export interface BatchResult {
  order: HubOrder;
  ok: boolean;
  error?: string;
}

export interface BatchState {
  type: string;
  orders: HubOrder[];
  current: number;
  results: BatchResult[];
}

export interface BatchProcessModalProps {
  state: BatchState;
  onClose: () => void;
}

function fmtAddr(o: HubOrder) {
  return formatOrderAddress({
    propertyStreet: o.propertyStreet,
    propertyCity: o.propertyCity,
    propertyState: o.propertyState,
    propertyZip: o.propertyZip,
  });
}

function batchTitle(type: string): string {
  if (type === 'cpl') return 'Batch CPL';
  if (type === 'proposed') return 'Batch Proposed Insured';
  return 'Batch Prelim Check';
}

export function BatchProcessModal({ state, onClose }: BatchProcessModalProps) {
  const finished = state.current === state.orders.length;
  const successCount = state.results.filter((r) => r.ok).length;
  const progressPct = state.orders.length === 0
    ? 0
    : (state.current / state.orders.length) * 100;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={batchTitle(state.type)}
      subtitle={`${state.orders.length} orders`}
    >
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-[#F26B2B] rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-[#6B7280] shrink-0 tabular-nums">
            {state.current}/{state.orders.length}
          </span>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {state.orders.map((o, i) => {
            const r = state.results[i];
            return (
              <div
                key={o.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 text-sm"
              >
                {r ? (
                  r.ok ? (
                    <svg className="h-4 w-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )
                ) : i < state.current ? (
                  <div className="w-4 h-4 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                )}
                <span className="font-mono text-xs font-medium text-[#1A1A2E]">{o.fileNumber}</span>
                <span className="text-xs text-[#6B7280] truncate">{fmtAddr(o)}</span>
                {r && !r.ok && (
                  <span className="text-[10px] text-red-500 ml-auto shrink-0">{r.error}</span>
                )}
              </div>
            );
          })}
        </div>
        {finished && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-sm text-[#1A1A2E] font-medium">
              {successCount}/{state.orders.length} succeeded
            </p>
            <button
              onClick={onClose}
              className="mt-3 w-full h-10 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
