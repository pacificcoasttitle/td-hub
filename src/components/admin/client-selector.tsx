'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ContactDropdown,
  ContactDropdownMessage,
  ContactResultButton,
  ContactSearchInput,
  ResolvedContactCard,
  contactInitial,
  formatContactAddress,
  joinIdentity,
} from './contact-picker';
import { CreatePartyWizard, type CreatedPartyContact } from './create-party-wizard';

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
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
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

/** Street + city for picker display. Empty string when nothing useful — never an em-dash. */
export const formatClientPickerAddress = formatContactAddress;

function clientIdentity(c: ClientContact): string {
  return joinIdentity([c.email, c.phone, c.companyName && c.fullName ? c.companyName : null]);
}

export function ClientSelector({ selected, onSelect, onClear, orderType }: ClientSelectorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientContact[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
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

  function handleCreated(c: CreatedPartyContact) {
    onSelect({
      id: c.id,
      fullName: c.fullName,
      companyName: c.companyName,
      email: c.email,
      phone: c.phone,
      role: 'realtor',
      contactType: 'realtor',
      clientLookupCode: c.clientLookupCode,
      companyLookupCode: c.companyLookupCode,
      address: c.address,
      city: c.city,
    });
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
      <ResolvedContactCard
        initial={contactInitial(selected.fullName, selected.companyName)}
        title={selected.fullName ?? selected.companyName ?? 'Unknown'}
        detail={clientIdentity(selected)}
        subDetail={formatContactAddress(selected)}
        onAction={onClear}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <ContactSearchInput
        value={query}
        onChange={handleInput}
        onFocus={() => { if (query.length >= 2) setOpen(true); }}
        placeholder="Search client by name or email…"
        searching={searching}
      />

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
        <ContactDropdown>
          {searching ? (
            <ContactDropdownMessage>Searching…</ContactDropdownMessage>
          ) : results.length > 0 ? (
            <>
            {results.map((c) => {
              const disabled = restricted && isEscrowClient(c);
              return (
                <ContactResultButton
                  key={c.id}
                  initial={contactInitial(c.fullName, c.companyName)}
                  title={c.fullName ?? c.companyName ?? 'Unknown'}
                  detail={disabled ? `Not available for ${orderType} orders` : clientIdentity(c)}
                  subDetail={formatContactAddress(c)}
                  badge={c.role ? c.role.replace(/_/g, ' ') : undefined}
                  disabled={disabled}
                  onClick={() => handleSelect(c)}
                />
              );
            })}
            <div className="px-3 py-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { setOpen(false); setCreateOpen(true); }}
                className="w-full h-8 text-xs font-medium text-[#1B2A4A] hover:underline"
              >
                None of these — create new client
              </button>
            </div>
            </>
          ) : (
            <div className="px-3 py-3">
              <ContactDropdownMessage>
                No clients found for &ldquo;{query}&rdquo;
              </ContactDropdownMessage>
              <button
                type="button"
                onClick={() => { setOpen(false); setCreateOpen(true); }}
                className="mt-2 w-full h-9 text-sm font-medium text-white bg-[#1B2A4A] rounded-lg hover:bg-[#243658]"
              >
                Create new client
              </button>
            </div>
          )}
        </ContactDropdown>
      )}

      <CreatePartyWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        userType="realtor"
        label="client"
        initialQuery={query}
      />
    </div>
  );
}
