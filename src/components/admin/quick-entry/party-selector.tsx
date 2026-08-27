'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ContactDropdown,
  ContactDropdownMessage,
  ContactNotice,
  ContactResultButton,
  ContactSearchInput,
  ResolvedContactCard,
  contactInitial,
  formatContactAddress,
  joinIdentity,
} from '@/components/admin/contact-picker';
import {
  applyContactSelection,
  partyDisplayName,
  partyHasInput,
  type ContactSearchHit,
} from '@/lib/domain/orders/party-contact';
import { EC, FL, type PartyContact } from './types';

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

interface CompanyRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lookupCode: string | null;
  address1?: string | null;
  city?: string | null;
}

/**
 * Company · email · phone, measured rather than chosen by taste.
 *
 * 40.6% of named active contacts share a name with another contact. Of the
 * name groups that are genuinely different people, company separates 83.5% and
 * email 80.8% — and neither subsumes the other, so both are needed: company
 * alone misses the 8.5% where only the email differs, email alone misses the
 * 11.5% where only the company does. Phone closes a further 3.1% and is on
 * 56.8% of colliding rows, so it earns third place and no higher.
 */
function partyIdentity(c: { company?: string; email?: string; phone?: string }): string {
  return joinIdentity([c.company, c.email, c.phone]);
}

export function PartySelector({
  c,
  set,
  includeCompanies,
  searchRole,
  label,
}: {
  c: PartyContact;
  set: (v: PartyContact) => void;
  /** Also search the companies table, for slots an operator names by firm. */
  includeCompanies?: boolean;
  searchRole: PartySearchRole;
  label: string;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback((q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); return; }
    setSearching(true);
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
          address: row.address,
          city: row.city,
        })));

    const all = includeCompanies
      ? Promise.all([
        fetch(`/api/companies?search=${enc}&pageSize=6${COMPANY_TYPE[searchRole] ? `&type=${encodeURIComponent(COMPANY_TYPE[searchRole]!)}` : ''}`)
          .then((r) => r.ok ? r.json() : { companies: [] })
          .then((d: { companies?: CompanyRow[] }) =>
            (d.companies ?? []).map((co) => ({
              id: -(co.id + 1),
              fullName: null,
              companyName: co.name,
              email: co.email,
              phone: co.phone,
              companyLookupCode: co.lookupCode,
              clientLookupCode: '',
              address: co.address1 ?? null,
              city: co.city ?? null,
            }))),
        contactsP,
      ]).then(([co, ct]) => [...co, ...ct].slice(0, 8))
      : contactsP;

    all.then(setSuggestions).catch(() => setSuggestions([])).finally(() => setSearching(false));
  }, [includeCompanies, searchRole]);

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  }

  function selectHit(hit: SearchHit) {
    set(applyContactSelection(hit));
    setQuery('');
    setSuggestions([]);
    setOpen(false);
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (partyHasInput(c)) {
    return (
      <div className="mb-3">
        <label className={FL}>{label}</label>
        <ResolvedContactCard
          initial={contactInitial(c.name, c.company)}
          title={c.name || c.company || 'Unknown'}
          detail={partyIdentity(c)}
          subDetail={formatContactAddress({ address: c.address, city: c.city })}
          onAction={() => set({ ...EC })}
        />
      </div>
    );
  }

  const searchOpen = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="mb-3 relative">
      <label className={FL}>{label}</label>
      <ContactSearchInput
        value={query}
        onChange={handleInput}
        onFocus={() => { if (query.trim().length >= 2) { setOpen(true); doSearch(query); } }}
        placeholder={`Search ${label.toLowerCase()} by name, company, or email…`}
        searching={searching}
      />

      {/* Legacy's real rule, stated rather than left to be discovered. Neutral
          on purpose: most of these six slots are legitimately empty on a normal
          order, and a form that shows five warnings on a normal order teaches
          operators to ignore warnings. Hidden while the operator is mid-search,
          where it would sit under the dropdown and describe a state they are
          already busy leaving. */}
      {!searchOpen && (
        <ContactNotice>
          No contact selected — this party will not be sent to SoftPro.
        </ContactNotice>
      )}

      {searchOpen && (
        <ContactDropdown>
          {searching ? (
            <ContactDropdownMessage>Searching…</ContactDropdownMessage>
          ) : suggestions.length > 0 ? (
            suggestions.map((hit) => (
              <ContactResultButton
                key={hit.id}
                initial={contactInitial(partyDisplayName(hit), hit.companyName)}
                title={partyDisplayName(hit) || hit.companyName || 'Unknown'}
                detail={partyIdentity({
                  company: hit.companyName ?? '',
                  email: hit.email ?? '',
                  phone: hit.phone ?? '',
                })}
                subDetail={formatContactAddress(hit)}
                onClick={() => selectHit(hit)}
              />
            ))
          ) : (
            <ContactDropdownMessage>
              No {label.toLowerCase()} found for &ldquo;{query.trim()}&rdquo;
            </ContactDropdownMessage>
          )}
        </ContactDropdown>
      )}
    </div>
  );
}
