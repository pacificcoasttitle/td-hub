'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ClientContact {
  id: number;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  contactType?: string | null;
  clientLookupCode?: string | null;
  companyLookupCode?: string | null;
  companySalesRepId?: number | null;
  companyTitleOfficerId?: number | null;
  companyLoanUnderwriter?: string | null;
  companySalesUnderwriter?: string | null;
}

interface ClientSelectorProps {
  selected: ClientContact | null;
  onSelect: (client: ClientContact) => void;
  onClear: () => void;
  orderType?: string;
}

const ESCROW_RESTRICTED_ORDERS = ['title & escrow', 'escrow only'];
const ESCROW_CONTACT_TYPES = ['escrow', 'escrow_company', 'escrow company', 'escrow officer'];

function isEscrowClient(c: ClientContact): boolean {
  const ct = (c.contactType ?? c.role ?? '').toLowerCase().trim();
  return ESCROW_CONTACT_TYPES.includes(ct);
}

function isEscrowRestricted(orderType?: string): boolean {
  return ESCROW_RESTRICTED_ORDERS.includes((orderType ?? '').toLowerCase().trim());
}

export function ClientSelector({ selected, onSelect, onClear, orderType }: ClientSelectorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientContact[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    fetch(`/api/contacts/search?q=${encodeURIComponent(q)}&pageSize=10`)
      .then((r) => r.ok ? r.json() : { results: [] })
      .then((d) => setResults(d.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function handleSelect(c: ClientContact) {
    onSelect(c);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const restricted = isEscrowRestricted(orderType);
  const [clearedMsg, setClearedMsg] = useState('');

  useEffect(() => {
    if (restricted && selected && isEscrowClient(selected)) {
      onClear();
      setClearedMsg('Escrow companies cannot be the opening party on Title & Escrow orders.');
      const t = setTimeout(() => setClearedMsg(''), 6000);
      return () => clearTimeout(t);
    }
  }, [restricted, selected, onClear]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (selected) {
    return (
      <div className="bg-[#1B2A4A]/5 border border-[#1B2A4A]/15 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-[#1B2A4A] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">
                {(selected.fullName ?? selected.companyName ?? '?').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1A1A2E] truncate">
                {selected.fullName ?? selected.companyName ?? 'Unknown'}
              </p>
              <p className="text-xs text-[#6B7280] truncate">
                {[selected.email, selected.phone, selected.companyName && selected.fullName ? selected.companyName : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-[#6B7280] border border-gray-200 rounded-lg hover:bg-white hover:text-[#1A1A2E] transition-colors"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        {searching && (
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#F26B2B] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder="Search client by name or email…"
          className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/40 focus:border-[#F26B2B] bg-white"
        />
      </div>

      {clearedMsg && (
        <div className="mt-1.5 flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="h-3.5 w-3.5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          <p className="text-xs text-amber-700">{clearedMsg}</p>
        </div>
      )}
      {!open && query.length < 2 && !clearedMsg && (
        <p className="mt-1.5 text-xs text-[#9CA3AF]">Search by name or email to find a client</p>
      )}

      {open && query.length >= 2 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {searching ? (
            <div className="px-4 py-4 text-sm text-[#6B7280] text-center">Searching…</div>
          ) : results.length > 0 ? (
            results.map((c) => {
              const disabled = restricted && isEscrowClient(c);
              return (
                <button
                  key={c.id}
                  onClick={() => !disabled && handleSelect(c)}
                  disabled={disabled}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${disabled ? 'bg-gray-200' : 'bg-[#1B2A4A]/10'}`}>
                      <span className={`text-xs font-bold ${disabled ? 'text-gray-400' : 'text-[#1B2A4A]'}`}>
                        {(c.fullName ?? c.companyName ?? '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${disabled ? 'text-gray-400' : 'text-[#1A1A2E]'}`}>
                        {c.fullName ?? c.companyName ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-[#6B7280] truncate">
                        {disabled
                          ? `Not available for ${orderType} orders`
                          : [c.email, c.phone, c.companyName && c.fullName ? c.companyName : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {c.role && (
                      <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${disabled ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-[#6B7280]'}`}>
                        {c.role.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="px-4 py-4 text-sm text-[#6B7280] text-center">
              No clients found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
