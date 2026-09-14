'use client';

import { useState, useRef, useEffect } from 'react';
import type { PartiesData, PartyContact, FormOption } from './types';
import { IN, EMPTY_PARTY } from './types';
import { SH, FL, Nav } from './shared';
import { partyVisibility } from '@/components/admin/quick-entry/parties-section';

export function StepAddParties({ data, onChange, orderTypeValue, clientType, transactionType, onNext, onPrev }: {
  data: PartiesData;
  onChange: (d: PartiesData) => void;
  orderTypeValue: string;
  clientType: string;
  transactionType: string;
  onNext: () => void;
  onPrev: () => void;
}) {
  const [escrowOfficers, setEscrowOfficers] = useState<FormOption[]>([]);
  const vis = partyVisibility(clientType, orderTypeValue, transactionType);
  const showAgentSection = vis.buyerAgent || vis.listingAgent;

  useEffect(() => {
    fetch('/api/form-options')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.escrowOfficers) return;
        const seen = new Set<string>();
        setEscrowOfficers(
          (d.escrowOfficers as Array<{ id?: number; name?: string; value?: string; label?: string; email?: string }>)
            .map((r) => ({ value: r.value ?? String(r.id ?? ''), label: r.label ?? r.name ?? r.email ?? '' }))
            .filter((o) => { const k = o.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        );
      })
      .catch(() => {});
  }, []);

  const dataRef = useRef(data);
  dataRef.current = data;
  const prevRef = useRef({ ct: clientType, ot: orderTypeValue, tt: transactionType });
  useEffect(() => {
    const prev = prevRef.current;
    if (prev.ct === clientType && prev.ot === orderTypeValue && prev.tt === transactionType) return;
    const pv = partyVisibility(prev.ct, prev.ot, prev.tt);
    prevRef.current = { ct: clientType, ot: orderTypeValue, tt: transactionType };
    const nv = partyVisibility(clientType, orderTypeValue, transactionType);
    const d = dataRef.current;
    let u = { ...d };
    let changed = false;
    const newAgents = nv.buyerAgent || nv.listingAgent;
    const oldAgents = pv.buyerAgent || pv.listingAgent;
    if (oldAgents && !newAgents && d.showAgents) { u = { ...u, showAgents: false, buyerAgent: { ...EMPTY_PARTY }, listingAgent: { ...EMPTY_PARTY } }; changed = true; }
    if (pv.lender && !nv.lender && d.showLender) { u = { ...u, showLender: false, lender: { ...EMPTY_PARTY } }; changed = true; }
    if (pv.escrowCompany && !nv.escrowCompany && d.showEscrow) { u = { ...u, showEscrow: false, escrow: { ...EMPTY_PARTY } }; changed = true; }
    if (pv.escrowOfficer && !nv.escrowOfficer && d.showEscrowOfficer) { u = { ...u, showEscrowOfficer: false, escrowOfficer: '' }; changed = true; }
    if (changed) onChange(u);
  }, [clientType, orderTypeValue, transactionType, onChange]);

  function upParty(key: 'buyerAgent' | 'listingAgent' | 'lender' | 'escrow', field: keyof PartyContact, value: string) {
    onChange({ ...data, [key]: { ...data[key], [field]: value } });
  }

  return (
    <div className="p-5 sm:p-6">
      <SH title="Add Parties" sub="Add agents, lender, and escrow contacts to this order." />

      <div className="space-y-4">
        {showAgentSection && (
          <ToggleSection
            label="Add Agent Details"
            open={data.showAgents}
            onToggle={(v) => onChange({ ...data, showAgents: v, ...(!v && { buyerAgent: { ...EMPTY_PARTY }, listingAgent: { ...EMPTY_PARTY } }) })}
          >
            <div className="space-y-4">
              {vis.buyerAgent && <PartyFields label="Buyer's Agent" contact={data.buyerAgent} onChange={(f, v) => upParty('buyerAgent', f, v)} />}
              {vis.listingAgent && (
                <div className={vis.buyerAgent ? 'border-t border-gray-100 pt-4' : ''}>
                  <PartyFields label="Listing Agent" contact={data.listingAgent} onChange={(f, v) => upParty('listingAgent', f, v)} />
                </div>
              )}
            </div>
          </ToggleSection>
        )}

        {vis.lender && (
          <ToggleSection
            label="Add Lender"
            open={data.showLender}
            onToggle={(v) => onChange({ ...data, showLender: v, ...(!v && { lender: { ...EMPTY_PARTY } }) })}
          >
            <PartyFields label="Lender" contact={data.lender} onChange={(f, v) => upParty('lender', f, v)} companyFirst />
          </ToggleSection>
        )}

        {vis.escrowCompany && (
          <ToggleSection
            label="Add Escrow Company"
            open={data.showEscrow}
            onToggle={(v) => onChange({ ...data, showEscrow: v, ...(!v && { escrow: { ...EMPTY_PARTY } }) })}
          >
            <PartyFields label="Escrow Company" contact={data.escrow} onChange={(f, v) => upParty('escrow', f, v)} companyFirst />
          </ToggleSection>
        )}

        {vis.escrowOfficer && (
          <ToggleSection
            label="Add Escrow Officer"
            open={data.showEscrowOfficer}
            onToggle={(v) => onChange({ ...data, showEscrowOfficer: v, ...(!v && { escrowOfficer: '' }) })}
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

        {/* "Deliverable Emails" removed — it promised additional notification
            recipients and no sending path ever read the addresses. See
            docs/tickets/DELIVERABLE_EMAILS.md. */}
      </div>

      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function ToggleSection({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl transition-colors ${open ? 'border-[#F26B2B]/30 bg-[#F26B2B]/[0.02]' : 'border-[#E5E7EB]'}`}>
      <button onClick={() => onToggle(!open)} className="w-full flex items-center justify-between px-4 py-3 min-h-[48px]">
        <span className="text-sm font-medium text-[#1B2A4A]">{label}</span>
        <div className={`w-10 h-6 rounded-full transition-colors relative ${open ? 'bg-[#F26B2B]' : 'bg-[#E5E7EB]'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${open ? 'left-5' : 'left-1'}`} />
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// No typeahead. It searched the master contact and company book, which a
// client may not read (contact-book-access.ts, 2026-09-14). There are no client
// accounts yet, so nobody has used it. If it is wanted, the replacement suggests
// only from parties on the client's own orders.
function PartyFields({ label, contact, onChange, companyFirst }: {
  label: string; contact: PartyContact; onChange: (field: keyof PartyContact, value: string) => void;
  companyFirst?: boolean;
}) {
  const firstField = companyFirst ? 'company' : 'name';
  const secondField = companyFirst ? 'name' : 'company';

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><FL>{companyFirst ? 'Company' : 'Name'}</FL><input className={IN} value={contact[firstField]} onChange={(e) => onChange(firstField, e.target.value)} /></div>
        <div><FL>{companyFirst ? 'Contact Name' : 'Company'}</FL><input className={IN} value={contact[secondField]} onChange={(e) => onChange(secondField, e.target.value)} /></div>
        <div><FL>Email</FL><input className={IN} type="email" value={contact.email} onChange={(e) => onChange('email', e.target.value)} placeholder="email@example.com" /></div>
        <div><FL>Phone</FL><input className={IN} type="tel" value={contact.phone} onChange={(e) => onChange('phone', e.target.value)} placeholder="(555) 123-4567" /></div>
      </div>
    </div>
  );
}
