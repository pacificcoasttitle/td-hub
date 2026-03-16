'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Contact } from './types';
import { IN } from './types';
import { SH, FL, Nav } from './shared';

export function StepContacts({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Contacts" sub="Assign contacts to this order." />
      <div className="space-y-5">
        <CSF label="Escrow Company" selected={data.escrowCompany} onSelect={(c) => onChange({ ...data, escrowCompany: c })} onClear={() => onChange({ ...data, escrowCompany: null })} url="/api/contacts?role=escrow_officer" />
        <CSF label="Lender" selected={data.lender} onSelect={(c) => onChange({ ...data, lender: c })} onClear={() => onChange({ ...data, lender: null })} url="/api/contacts?role=lender" />
        <CSF label="Buyer's Agent" selected={data.buyerAgent} onSelect={(c) => onChange({ ...data, buyerAgent: c })} onClear={() => onChange({ ...data, buyerAgent: null })} url="/api/contacts?role=buyer_agent" />
        <CSF label="Listing Agent" selected={data.listingAgent} onSelect={(c) => onChange({ ...data, listingAgent: c })} onClear={() => onChange({ ...data, listingAgent: null })} url="/api/contacts?role=listing_agent" />
        <CSF label="Title Officer" selected={data.titleOfficer} onSelect={(c) => onChange({ ...data, titleOfficer: c })} onClear={() => onChange({ ...data, titleOfficer: null })} url="/api/contacts?role=title_officer" />
      </div>
      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function CSF({ label, selected, onSelect, onClear, url }: {
  label: string; selected: Contact | null; onSelect: (c: Contact) => void; onClear: () => void; url: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const sep = url.includes('?') ? '&' : '?';
    fetch(`${url}${sep}search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => setResults(d.contacts ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [url]);

  function handleInput(v: string) { setQuery(v); setOpen(true); clearTimeout(debRef.current); debRef.current = setTimeout(() => search(v), 250); }

  useEffect(() => {
    function click(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  if (selected) {
    return (
      <div><FL>{label}</FL>
        <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg min-h-[44px]">
          <div><p className="text-sm font-medium text-[#1A1A2E]">{selected.fullName ?? selected.companyName ?? 'Contact'}</p><p className="text-xs text-[#6B7280]">{[selected.email, selected.phone].filter(Boolean).join(' · ')}</p></div>
          <button onClick={onClear} className="text-xs text-red-500 ml-3 min-h-[44px]">Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative"><FL>{label}</FL>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={query} onChange={(e) => handleInput(e.target.value)} onFocus={() => { if (query.length >= 2) setOpen(true); }} placeholder={`Search ${label.toLowerCase()}…`} className={`${IN} pl-10`} />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {searching ? <div className="px-4 py-3 text-sm text-[#6B7280]">Searching…</div>
            : results.length > 0 ? results.map((c) => (
              <button key={c.id} onClick={() => { onSelect(c); setQuery(''); setResults([]); setOpen(false); }} className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 min-h-[44px]">
                <p className="text-sm font-medium text-[#1A1A2E]">{c.fullName ?? c.companyName ?? 'Unknown'}</p>
                <p className="text-xs text-[#6B7280]">{[c.email].filter(Boolean).join(' · ')}</p>
              </button>
            )) : <div className="px-4 py-3 text-sm text-[#6B7280]">No results</div>}
        </div>
      )}
    </div>
  );
}
