'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContactResult, ContactsData } from './types';
import { INPUT_CLASS } from './constants';
import { FieldLabel, StepHeader, StepNav } from './shared';

export function Step5Contacts({
  data, onChange, onNext, onPrev,
}: {
  data: ContactsData; onChange: (d: ContactsData) => void; onNext: () => void; onPrev: () => void;
}) {
  return (
    <div className="p-6">
      <StepHeader title="Contacts" sub="Assign contacts to this order. Search by name." />

      <div className="space-y-5">
        <ContactSearchField
          label="Escrow Company"
          selected={data.escrowCompany}
          onSelect={(c) => onChange({ ...data, escrowCompany: c })}
          onClear={() => onChange({ ...data, escrowCompany: null })}
          searchUrl="/api/contacts?role=escrow_officer"
        />
        <ContactSearchField
          label="Lender"
          selected={data.lender}
          onSelect={(c) => onChange({ ...data, lender: c })}
          onClear={() => onChange({ ...data, lender: null })}
          searchUrl="/api/contacts?role=lender"
        />
        <ContactSearchField
          label="Buyer's Agent"
          selected={data.buyerAgent}
          onSelect={(c) => onChange({ ...data, buyerAgent: c })}
          onClear={() => onChange({ ...data, buyerAgent: null })}
          searchUrl="/api/contacts?role=buyer_agent"
        />
        <ContactSearchField
          label="Listing Agent"
          selected={data.listingAgent}
          onSelect={(c) => onChange({ ...data, listingAgent: c })}
          onClear={() => onChange({ ...data, listingAgent: null })}
          searchUrl="/api/contacts?role=listing_agent"
        />
        <ContactSearchField
          label="Title Officer"
          selected={data.titleOfficer}
          onSelect={(c) => onChange({ ...data, titleOfficer: c })}
          onClear={() => onChange({ ...data, titleOfficer: null })}
          searchUrl="/api/contacts?role=title_officer"
        />
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function ContactSearchField({
  label, selected, onSelect, onClear, searchUrl,
}: {
  label: string; selected: ContactResult | null;
  onSelect: (c: ContactResult) => void; onClear: () => void; searchUrl: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const sep = searchUrl.includes('?') ? '&' : '?';
    fetch(`${searchUrl}${sep}search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => setResults(d.contacts ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [searchUrl]);

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }

  function handleSelect(c: ContactResult) {
    onSelect(c);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (selected) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
          <div>
            <p className="text-sm font-medium text-[#1A1A2E]">{selected.fullName ?? selected.companyName ?? 'Contact'}</p>
            <p className="text-xs text-[#6B7280]">
              {[selected.companyName && selected.fullName ? selected.companyName : null, selected.email, selected.phone].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 font-medium ml-3 flex-shrink-0">
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder={`Search ${label.toLowerCase()}…`}
          className={`${INPUT_CLASS} pl-10`}
        />
      </div>
      {open && (query.length >= 2) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {searching ? (
            <div className="px-4 py-3 text-sm text-[#6B7280]">Searching…</div>
          ) : results.length > 0 ? (
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
              >
                <p className="text-sm font-medium text-[#1A1A2E]">{c.fullName ?? c.companyName ?? 'Unknown'}</p>
                <p className="text-xs text-[#6B7280]">
                  {[c.companyName && c.fullName ? c.companyName : null, c.email].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-[#6B7280]">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>
      )}
    </div>
  );
}
