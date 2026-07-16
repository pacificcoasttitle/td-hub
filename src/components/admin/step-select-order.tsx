'use client';

import { useCallback, useRef, useState } from 'react';
import { statusBadge } from '@/lib/domain/orders/status-format';

export interface OrderResult {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  property: { address: string | null; city: string | null; state: string | null } | null;
}

export function StepSelectOrder({ onSelect }: { onSelect: (o: OrderResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/orders?search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { orders: [] })
      .then((d) => setResults(d.orders ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1">Select Order</h3>
      <p className="text-sm text-[#6B7280] mb-4">Search by file number or property address</p>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="File number or address…"
          autoFocus
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
        />
      </div>

      {loading && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="mt-3 space-y-1">
          {results.map((o) => {
            const addr = [o.property?.address, o.property?.city, o.property?.state].filter(Boolean).join(', ');
            return (
              <li key={o.id}>
                <button
                  onClick={() => onSelect(o)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-[#C5A55A] hover:bg-[#C5A55A]/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#1A1A2E]">{o.fileNumber}</span>
                    <StatusBadge status={o.operationalStatus} />
                  </div>
                  {addr && <p className="text-sm text-[#6B7280] mt-0.5">{addr}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="mt-4 text-center text-sm text-[#6B7280]">No orders found for &quot;{query}&quot;</p>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const badge = statusBadge(status);
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}>
      {badge.label}
    </span>
  );
}

export function OrderSummaryBanner({ order }: { order: OrderResult }) {
  const addr = [order.property?.address, order.property?.city, order.property?.state].filter(Boolean).join(', ');
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
      <div>
        <p className="font-medium text-[#1A1A2E] text-sm">{order.fileNumber}</p>
        {addr && <p className="text-xs text-[#6B7280]">{addr}</p>}
      </div>
      <StatusBadge status={order.operationalStatus} />
    </div>
  );
}

export function SummaryField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3 bg-gray-50 rounded-lg">
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="font-medium text-[#1A1A2E] mt-0.5">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-0.5">{sub}</p>}
    </div>
  );
}

export function FormField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#6B7280] mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
      />
    </div>
  );
}
