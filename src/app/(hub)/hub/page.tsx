'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { OrdersHubTable, type HubOrder } from '@/components/shared/orders-hub-table';

interface QuickResult {
  id: number;
  fileNumber: string;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  operationalStatus: string | null;
}

export default function HubPage() {
  const [selectedOrder, setSelectedOrder] = useState<HubOrder | null>(null);

  const [qsQuery, setQsQuery] = useState('');
  const [qsResults, setQsResults] = useState<QuickResult[]>([]);
  const [qsOpen, setQsOpen] = useState(false);
  const qsRef = useRef<HTMLDivElement>(null);
  const qsDebRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch('/api/form-options').catch(() => {});
    fetch('/api/branches').catch(() => {});
  }, []);

  function handleQsInput(v: string) {
    setQsQuery(v);
    clearTimeout(qsDebRef.current);
    if (v.length < 2) { setQsResults([]); setQsOpen(false); return; }
    qsDebRef.current = setTimeout(() => {
      fetch(`/api/orders/quick-search?q=${encodeURIComponent(v)}`)
        .then((r) => r.ok ? r.json() : { results: [] })
        .then((d) => { setQsResults(d.results ?? []); setQsOpen(true); })
        .catch(() => {});
    }, 200);
  }

  useEffect(() => {
    function click(e: MouseEvent) { if (qsRef.current && !qsRef.current.contains(e.target as Node)) setQsOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  function addr(o: QuickResult) {
    return [o.propertyStreet, o.propertyCity, o.propertyState].filter(Boolean).join(', ') || '—';
  }

  return (
    <div className="flex flex-col h-full">
      {/* Quick Actions Bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
        <Link href="/hub/new-order"
          className="px-4 h-9 bg-[#F26B2B] text-white text-xs font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors inline-flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          New Order
        </Link>

        <ActionBarBtn label="Generate CPL" disabled={!selectedOrder} />
        <ActionBarBtn label="Proposed Insured" disabled={!selectedOrder} />
        <ActionBarBtn label="Find Prelim" disabled={!selectedOrder} />

        <div className="flex-1" />

        {/* Quick Search */}
        <div ref={qsRef} className="relative w-64">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={qsQuery} onChange={(e) => handleQsInput(e.target.value)}
              onFocus={() => { if (qsQuery.length >= 2 && qsResults.length > 0) setQsOpen(true); }}
              placeholder="Quick find file # or address…"
              className="w-full h-9 pl-8 pr-3 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B] outline-none" />
          </div>
          {qsOpen && qsResults.length > 0 && (
            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {qsResults.map((r) => (
                <button key={r.id} onClick={() => {
                  setSelectedOrder({ ...r, transactionType: null, openedAt: null });
                  setQsOpen(false); setQsQuery(r.fileNumber);
                }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                  <span className="text-xs font-mono font-semibold text-[#1A1A2E]">{r.fileNumber}</span>
                  <span className="text-xs text-[#6B7280] ml-2">{addr(r)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Shared Orders Table */}
      <OrdersHubTable
        fetchUrl="/api/orders"
        actions={['cpl', 'prelim', 'proposed', 'notes', 'detail']}
        compact
        accentColor="#F26B2B"
        showSearch
        showStatusFilter
        pageSize={25}
        pollMs={30_000}
        onOrderSelect={setSelectedOrder}
        className="flex-1 min-h-0"
      />
    </div>
  );
}

function ActionBarBtn({ label, disabled }: { label: string; disabled: boolean }) {
  return (
    <button disabled={disabled}
      className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
      {label}
    </button>
  );
}
