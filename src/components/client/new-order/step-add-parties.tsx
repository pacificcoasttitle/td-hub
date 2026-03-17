'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { PartiesData, PartyContact, FormOption } from './types';
import { IN, EMPTY_PARTY } from './types';
import { SH, FL, Nav } from './shared';

export function StepAddParties({ data, onChange, orderTypeValue, onNext, onPrev }: {
  data: PartiesData;
  onChange: (d: PartiesData) => void;
  orderTypeValue: string;
  onNext: () => void;
  onPrev: () => void;
}) {
  const [escrowOfficers, setEscrowOfficers] = useState<FormOption[]>([]);
  const showEscrowOfficerOption = orderTypeValue === 'title_escrow' || orderTypeValue === 'escrow_only';

  useEffect(() => {
    fetch('/api/form-options')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.escrowOfficers) return;
        setEscrowOfficers(
          (d.escrowOfficers as Array<{ id?: number; name?: string; value?: string; label?: string; email?: string }>)
            .map((r) => ({ value: r.value ?? String(r.id ?? ''), label: r.label ?? r.name ?? r.email ?? '' }))
        );
      })
      .catch(() => {});
  }, []);

  function upParty(key: 'buyerAgent' | 'listingAgent' | 'lender' | 'escrow', field: keyof PartyContact, value: string) {
    onChange({ ...data, [key]: { ...data[key], [field]: value } });
  }

  function addEmail() {
    if (data.deliverableEmails.length < 5) {
      onChange({ ...data, deliverableEmails: [...data.deliverableEmails, ''] });
    }
  }

  function updateEmail(index: number, value: string) {
    const emails = [...data.deliverableEmails];
    emails[index] = value;
    onChange({ ...data, deliverableEmails: emails });
  }

  function removeEmail(index: number) {
    onChange({ ...data, deliverableEmails: data.deliverableEmails.filter((_, i) => i !== index) });
  }

  return (
    <div className="p-5 sm:p-6">
      <SH title="Add Parties" sub="Add agents, lender, and escrow contacts to this order." />

      <div className="space-y-4">
        <ToggleSection
          label="Add Agent Details"
          open={data.showAgents}
          onToggle={(v) => onChange({
            ...data, showAgents: v,
            ...(!v && { buyerAgent: { ...EMPTY_PARTY }, listingAgent: { ...EMPTY_PARTY } }),
          })}
        >
          <div className="space-y-4">
            <PartyFields label="Buyer's Agent" contact={data.buyerAgent} onChange={(f, v) => upParty('buyerAgent', f, v)} searchRole="buyer_agent" />
            <div className="border-t border-gray-100 pt-4">
              <PartyFields label="Listing Agent" contact={data.listingAgent} onChange={(f, v) => upParty('listingAgent', f, v)} searchRole="listing_agent" />
            </div>
          </div>
        </ToggleSection>

        <ToggleSection
          label="Add Lender"
          open={data.showLender}
          onToggle={(v) => onChange({
            ...data, showLender: v,
            ...(!v && { lender: { ...EMPTY_PARTY } }),
          })}
        >
          <PartyFields label="Lender" contact={data.lender} onChange={(f, v) => upParty('lender', f, v)} searchRole="lender" companyFirst />
        </ToggleSection>

        <ToggleSection
          label="Add Escrow"
          open={data.showEscrow}
          onToggle={(v) => onChange({
            ...data, showEscrow: v,
            ...(!v && { escrow: { ...EMPTY_PARTY } }),
          })}
        >
          <PartyFields label="Escrow Company" contact={data.escrow} onChange={(f, v) => upParty('escrow', f, v)} searchRole="escrow_officer" companyFirst />
        </ToggleSection>

        {showEscrowOfficerOption && (
          <ToggleSection
            label="Add Escrow Officer"
            open={data.showEscrowOfficer}
            onToggle={(v) => onChange({
              ...data, showEscrowOfficer: v,
              ...(!v && { escrowOfficer: '' }),
            })}
          >
            <div>
              <FL>Escrow Officer</FL>
              {escrowOfficers.length ? (
                <select value={data.escrowOfficer} onChange={(e) => onChange({ ...data, escrowOfficer: e.target.value })} className={IN}>
                  <option value="">Select…</option>
                  {escrowOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input className={IN} value={data.escrowOfficer} onChange={(e) => onChange({ ...data, escrowOfficer: e.target.value })} placeholder="Escrow officer name" />
              )}
            </div>
          </ToggleSection>
        )}

        <div className="border-t border-gray-100 pt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Deliverable Emails</p>
              <p className="text-xs text-[#9CA3AF] mt-0.5">Additional recipients for order notifications</p>
            </div>
            {data.deliverableEmails.length < 5 && (
              <button onClick={addEmail} className="text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A] min-h-[44px] flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add
              </button>
            )}
          </div>
          {data.deliverableEmails.map((email, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className={IN} type="email" value={email} onChange={(e) => updateEmail(i, e.target.value)} placeholder="email@example.com" />
              <button onClick={() => removeEmail(i)} className="text-red-500 hover:text-red-700 px-2 min-h-[44px]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function ToggleSection({ label, open, onToggle, children }: {
  label: string;
  open: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl transition-colors ${open ? 'border-[#F26B2B]/30 bg-[#F26B2B]/[0.02]' : 'border-[#E5E7EB]'}`}>
      <button
        onClick={() => onToggle(!open)}
        className="w-full flex items-center justify-between px-4 py-3 min-h-[48px]"
      >
        <span className="text-sm font-medium text-[#1B2A4A]">{label}</span>
        <div className={`w-10 h-6 rounded-full transition-colors relative ${open ? 'bg-[#F26B2B]' : 'bg-[#E5E7EB]'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${open ? 'left-5' : 'left-1'}`} />
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function PartyFields({ label, contact, onChange, searchRole, companyFirst }: {
  label: string;
  contact: PartyContact;
  onChange: (field: keyof PartyContact, value: string) => void;
  searchRole: string;
  companyFirst?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ id: number; fullName: string | null; companyName: string | null; email: string | null; phone: string | null }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchField = companyFirst ? 'company' : 'name';
  const searchValue = contact[searchField];

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const enc = encodeURIComponent(q);

    const contactsP = fetch(`/api/contacts?search=${enc}&pageSize=6`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d: { contacts?: Array<{ id: number; fullName: string | null; companyName: string | null; email: string | null; phone: string | null }> }) =>
        (d.contacts ?? []).map((c) => ({ ...c, id: c.id }))
      );

    if (companyFirst) {
      const companiesP = fetch(`/api/companies?search=${enc}&pageSize=6`)
        .then((r) => r.ok ? r.json() : { companies: [] })
        .then((d: { companies?: Array<{ id: number; name: string; email: string | null; phone: string | null }> }) =>
          (d.companies ?? []).map((c) => ({
            id: -(c.id + 1),
            fullName: null as string | null,
            companyName: c.name,
            email: c.email,
            phone: c.phone,
          }))
        );

      Promise.all([companiesP, contactsP])
        .then(([co, ct]) => setSuggestions([...co, ...ct].slice(0, 8)))
        .catch(() => setSuggestions([]));
    } else {
      contactsP
        .then((ct) => setSuggestions(ct))
        .catch(() => setSuggestions([]));
    }
  }, [companyFirst]);

  function handleSearchInput(value: string) {
    onChange(searchField, value);
    setShowSuggestions(true);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => doSearch(value), 250);
  }

  function selectSuggestion(s: (typeof suggestions)[number]) {
    onChange('name', s.fullName ?? '');
    onChange('company', s.companyName ?? '');
    onChange('email', s.email ?? '');
    onChange('phone', s.phone ?? '');
    setShowSuggestions(false);
    setSuggestions([]);
  }

  useEffect(() => {
    function click(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  return (
    <div ref={containerRef}>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <FL>{companyFirst ? 'Company' : 'Name'}</FL>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className={`${IN} pl-10`}
              value={searchValue}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => { if (searchValue.length >= 2) setShowSuggestions(true); }}
              placeholder={`Search ${label.toLowerCase()}…`}
            />
          </div>
          {showSuggestions && searchValue.length >= 2 && suggestions.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button key={s.id} onClick={() => selectSuggestion(s)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 min-h-[44px]">
                  <p className="text-sm font-medium text-[#1B2A4A]">{s.fullName ?? s.companyName ?? 'Unknown'}</p>
                  <p className="text-xs text-[#6B7280]">{[s.email, s.phone].filter(Boolean).join(' · ')}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <FL>{companyFirst ? 'Contact Name' : 'Company'}</FL>
          <input className={IN} value={companyFirst ? contact.name : contact.company} onChange={(e) => onChange(companyFirst ? 'name' : 'company', e.target.value)} />
        </div>
        <div><FL>Email</FL><input className={IN} type="email" value={contact.email} onChange={(e) => onChange('email', e.target.value)} placeholder="email@example.com" /></div>
        <div><FL>Phone</FL><input className={IN} type="tel" value={contact.phone} onChange={(e) => onChange('phone', e.target.value)} placeholder="(555) 123-4567" /></div>
      </div>
    </div>
  );
}
