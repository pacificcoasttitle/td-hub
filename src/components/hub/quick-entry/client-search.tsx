'use client';

import { useState } from 'react';
import { useContactSearch, type ContactResult } from '@/hooks/use-contact-search';
import type { ClientContact } from '@/components/admin/client-selector';
import { IN } from '@/components/admin/quick-entry/types';
import type { QuickEntryState } from '@/components/admin/quick-entry/use-quick-entry';
import { Spinner } from './shared';

function toClientContact(c: ContactResult): ClientContact {
  return {
    id: c.id,
    fullName: c.fullName ?? null,
    companyName: c.companyName ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    role: null,
    contactType: c.contactType ?? null,
  };
}

export function ClientSearch({ s }: { s: QuickEntryState }) {
  const [query, setQuery] = useState('');
  const { results, open, searching, search, close, ref } = useContactSearch('EscrowCompany');

  function handleInput(v: string) {
    setQuery(v);
    search(v);
  }

  if (s.client) {
    return (
      <div className="flex items-start justify-between p-4 bg-[#F26B2B]/5 border border-[#F26B2B]/20 rounded-lg">
        <div>
          <p className="text-sm font-semibold text-[#1A1A2E]">{s.client.fullName ?? s.client.companyName ?? 'Client'}</p>
          <p className="text-xs text-[#6B7280] mt-0.5">{[s.client.email, s.client.phone].filter(Boolean).join(' · ')}</p>
          {s.client.companyName && s.client.fullName && <p className="text-xs text-[#6B7280]">{s.client.companyName}</p>}
          {s.client.contactType && <span className="inline-flex mt-1 px-2 py-0.5 bg-[#F26B2B]/10 text-[#F26B2B] text-[10px] font-semibold rounded capitalize">{s.client.contactType.replace(/_/g, ' ')}</span>}
        </div>
        <button onClick={() => { s.setClient(null); setQuery(''); close(); }} className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] shrink-0">Change</button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={query} onChange={e => handleInput(e.target.value)} placeholder="Search by name, email, or company…"
          className={`${IN} pl-10`} />
        {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner /></div>}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map(c => (
            <button key={c.id} onClick={() => { s.setClient(toClientContact(c)); close(); setQuery(''); }}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#1A1A2E] truncate">{c.fullName ?? c.companyName ?? '—'}</p>
                  <p className="text-xs text-[#6B7280] truncate">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
                  {c.companyName && c.fullName && <p className="text-[10px] text-[#9CA3AF]">{c.companyName}</p>}
                </div>
                {c.contactType && <span className="inline-flex px-2 py-0.5 bg-gray-100 text-[10px] font-semibold rounded text-[#4B5563] capitalize shrink-0">{c.contactType.replace(/_/g, ' ')}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && !searching && query.length >= 2 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-sm text-[#6B7280]">No contacts found</div>
      )}
    </div>
  );
}
