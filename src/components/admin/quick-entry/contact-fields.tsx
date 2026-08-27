'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyContactSelection,
  partyHasInput,
  partyReachesSoftPro,
  type ContactSearchHit,
} from '@/lib/domain/orders/party-contact';
import type { PartyContact } from './types';
import { IN, FL } from './types';

export type PartySearchRole = 'buyer_agent' | 'listing_agent' | 'lender' | 'mortgage_broker' | 'escrow';

const SEARCH_TYPE: Record<PartySearchRole, string> = {
  buyer_agent: 'agent',
  listing_agent: 'agent',
  lender: 'lender',
  mortgage_broker: 'mortgage_broker',
  escrow: 'escrow',
};

const COMPANY_TYPE: Partial<Record<PartySearchRole, string>> = {
  lender: 'lender',
  mortgage_broker: 'mortgage_broker',
  escrow: 'escrow_company',
  buyer_agent: 'realtor',
  listing_agent: 'realtor',
};

interface SearchHit extends ContactSearchHit {
  id: number;
}

export function ContactFields({
  c,
  set,
  companyFirst,
  searchRole,
  label,
}: {
  c: PartyContact;
  set: (v: PartyContact) => void;
  companyFirst?: boolean;
  searchRole: PartySearchRole;
  label: string;
}) {
  const [suggestions, setSuggestions] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchField = companyFirst ? 'company' : 'name';
  const searchValue = c[searchField];
  const incomplete = partyHasInput(c) && !partyReachesSoftPro(c);

  const doSearch = useCallback((q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); return; }
    const enc = encodeURIComponent(q.trim());
    const type = SEARCH_TYPE[searchRole];
    const contactsP = fetch(`/api/contacts/search?q=${enc}&pageSize=8&type=${type}`)
      .then((r) => r.ok ? r.json() : { results: [] })
      .then((d: { results?: Array<ContactSearchHit & { id: number }> }) =>
        (d.results ?? []).map((row) => ({
          id: row.id,
          fullName: row.fullName,
          firstName: row.firstName,
          lastName: row.lastName,
          companyName: row.companyName,
          email: row.email,
          phone: row.phone,
          lookupCode: row.lookupCode ?? row.clientLookupCode,
          clientLookupCode: row.clientLookupCode ?? row.lookupCode,
          companyLookupCode: row.companyLookupCode,
          flookupCode: row.flookupCode,
        })));

    if (companyFirst) {
      const companyType = COMPANY_TYPE[searchRole];
      const typeQ = companyType ? `&type=${encodeURIComponent(companyType)}` : '';
      const companiesP = fetch(`/api/companies?search=${enc}&pageSize=6${typeQ}`)
        .then((r) => r.ok ? r.json() : { companies: [] })
        .then((d: { companies?: Array<{ id: number; name: string; email: string | null; phone: string | null; lookupCode: string | null }> }) =>
          (d.companies ?? []).map((co) => ({
            id: -(co.id + 1),
            fullName: null,
            companyName: co.name,
            email: co.email,
            phone: co.phone,
            companyLookupCode: co.lookupCode,
            clientLookupCode: '',
          })));
      Promise.all([companiesP, contactsP])
        .then(([co, ct]) => setSuggestions([...co, ...ct].slice(0, 8)))
        .catch(() => setSuggestions([]));
    } else {
      contactsP.then(setSuggestions).catch(() => setSuggestions([]));
    }
  }, [companyFirst, searchRole]);

  function onSearchChange(value: string) {
    set({
      ...c,
      [searchField]: value,
      companyLookupCode: '',
      clientLookupCode: '',
      contactId: undefined,
    });
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  }

  function selectHit(hit: SearchHit) {
    set(applyContactSelection(hit));
    setOpen(false);
    setSuggestions([]);
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef}>
      <div className="mb-3 relative">
        <label className={FL}>{companyFirst ? 'Company Name' : 'Name'}</label>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            className={`${IN} pl-10`}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => { if (searchValue.trim().length >= 2) { setOpen(true); doSearch(searchValue); } }}
            placeholder={`Search ${label.toLowerCase()}…`}
            autoComplete="off"
          />
        </div>
        {open && searchValue.trim().length >= 2 && suggestions.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => selectHit(hit)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 min-h-[44px]"
              >
                <p className="text-sm font-medium text-[#1A1A2E]">{partyDisplayLine(hit)}</p>
                <p className="text-xs text-[#6B7280] truncate">
                  {[hit.email, hit.phone, hit.companyName && hit.fullName ? hit.companyName : null].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {companyFirst && (
        <div className="mb-3">
          <label className={FL}>Contact Name</label>
          <input className={IN} value={c.name} onChange={(e) => set({ ...c, name: e.target.value })} autoComplete="off" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <label className={FL}>Email</label>
          <input className={IN} type="email" value={c.email} onChange={(e) => set({ ...c, email: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <label className={FL}>Phone</label>
          <input className={IN} type="tel" value={c.phone} onChange={(e) => set({ ...c, phone: e.target.value })} autoComplete="off" />
        </div>
      </div>

      {!companyFirst && (
        <div className="mb-3">
          <label className={FL}>Company</label>
          <input className={IN} value={c.company} onChange={(e) => set({ ...c, company: e.target.value })} autoComplete="off" />
        </div>
      )}

      {incomplete && (
        <p className="text-xs text-amber-700 mb-3">
          A name alone won&apos;t save this party; add an email or company.
        </p>
      )}
    </div>
  );
}

function partyDisplayLine(hit: ContactSearchHit): string {
  const full = hit.fullName?.trim();
  if (full) return full;
  const parts = [hit.firstName, hit.lastName].filter((p) => !!p?.trim()).join(' ').trim();
  return parts || hit.companyName || 'Unknown';
}
