'use client';

import { useState, useEffect, useRef } from 'react';
import { SECTION, SH, FL, IN, SEL, EC, type PartyContact } from './types';
import type { QuickEntryState } from './use-quick-entry';

// ─── Visibility Logic (exported for other sections to consume) ──────────────

export interface PartyVis {
  buyerAgent: boolean; listingAgent: boolean; lender: boolean;
  mortgageBroker: boolean; escrowCompany: boolean; escrowOfficer: boolean;
  seller: boolean; borrower: boolean;
}

export function partyVisibility(ct: string | null | undefined, ot: string, tt: string): PartyVis {
  const c = (ct ?? '').toLowerCase().trim().replace(/_/g, ' ');
  const o = ot.toLowerCase().trim();
  const t = tt.toLowerCase().trim();

  const isListingSelling = ['listing agent', 'selling agent'].includes(c);
  const isEscrowClient = ['escrow company', 'escrow officer', 'escrow'].includes(c);

  const extEscrow = ['title only', 'title_only', 'sub escrow', 'sub_escrow', ''].includes(o);
  const intEscrow = ['title & escrow', 'title_escrow', 'escrow only', 'escrow_only'].includes(o);

  return {
    buyerAgent: !['agent', 'listing agent', 'selling agent'].includes(c),
    listingAgent: !isListingSelling,
    lender: c !== 'lender',
    mortgageBroker: c !== 'mortgage broker',
    escrowCompany: extEscrow && !isEscrowClient,
    escrowOfficer: intEscrow,
    seller: t === 'purchase' || t === 'other' || !t,
    borrower: t === 'purchase' || t === 'refinance' || t === 'equity' || t === 'other' || !t,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasData(c: PartyContact): boolean { return !!(c.name || c.company); }

function dedup(opts: { value: string; label: string }[]) {
  const seen = new Set<string>();
  return opts.filter(o => { const k = o.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

type ShowState = Record<'buyerAgent' | 'listingAgent' | 'lender' | 'mortgageBroker' | 'escrowCompany' | 'escrowOfficer', boolean>;
type PK = keyof ShowState;

// ─── Reusable Contact Fields ────────────────────────────────────────────────

function ContactFields({ c, set, companyFirst }: { c: PartyContact; set: (v: PartyContact) => void; companyFirst?: boolean }) {
  const f1 = companyFirst ? 'company' : 'name';
  const f2 = companyFirst ? 'name' : 'company';
  return (
    <>
      <div className="mb-3"><label className={FL}>{companyFirst ? 'Company Name' : 'Name'}</label><input className={IN} value={c[f1]} onChange={e => set({ ...c, [f1]: e.target.value })} /></div>
      {companyFirst && <div className="mb-3"><label className={FL}>Contact Name</label><input className={IN} value={c.name} onChange={e => set({ ...c, name: e.target.value })} /></div>}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div><label className={FL}>Email</label><input className={IN} type="email" value={c.email} onChange={e => set({ ...c, email: e.target.value })} /></div>
        <div><label className={FL}>Phone</label><input className={IN} type="tel" value={c.phone} onChange={e => set({ ...c, phone: e.target.value })} /></div>
      </div>
      {!companyFirst && <div className="mb-3"><label className={FL}>Company</label><input className={IN} value={c[f2]} onChange={e => set({ ...c, [f2]: e.target.value })} /></div>}
    </>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function PartiesSection({ s }: { s: QuickEntryState }) {
  const ct = s.client?.contactType ?? null;
  const ot = s.orderType ?? '';
  const tt = s.txType ?? '';
  const vis = partyVisibility(ct, ot, tt);

  const [show, setShow] = useState<ShowState>(() => ({
    buyerAgent: hasData(s.buyerAgent),
    listingAgent: hasData(s.listingAgent),
    lender: hasData(s.lender),
    mortgageBroker: false,
    escrowCompany: hasData(s.escrow),
    escrowOfficer: !!s.escrowOfficer,
  }));

  const [broker, setBroker] = useState<PartyContact>({ ...EC });

  const prevRef = useRef({ ct, ot, tt });
  useEffect(() => {
    const prev = prevRef.current;
    if (prev.ct === ct && prev.ot === ot && prev.tt === tt) return;
    const pv = partyVisibility(prev.ct, prev.ot, prev.tt);
    prevRef.current = { ct, ot, tt };
    const nv = partyVisibility(ct, ot, tt);

    if (pv.buyerAgent && !nv.buyerAgent) s.setBuyerAgent({ ...EC });
    if (pv.listingAgent && !nv.listingAgent) s.setListingAgent({ ...EC });
    if (pv.lender && !nv.lender) s.setLender({ ...EC });
    if (pv.mortgageBroker && !nv.mortgageBroker) setBroker({ ...EC });
    if (pv.escrowCompany && !nv.escrowCompany) s.setEscrow({ ...EC });
    if (pv.escrowOfficer && !nv.escrowOfficer) s.setEscrowOfficer('');

    setShow(p => ({
      buyerAgent: nv.buyerAgent ? p.buyerAgent : false,
      listingAgent: nv.listingAgent ? p.listingAgent : false,
      lender: nv.lender ? p.lender : false,
      mortgageBroker: nv.mortgageBroker ? p.mortgageBroker : false,
      escrowCompany: nv.escrowCompany ? p.escrowCompany : false,
      escrowOfficer: nv.escrowOfficer ? p.escrowOfficer : false,
    }));
  }, [ct, ot, tt, s]);

  function toggle(key: PK, on: boolean) {
    setShow(p => ({ ...p, [key]: on }));
    if (!on) {
      const clears: Record<PK, () => void> = {
        buyerAgent: () => s.setBuyerAgent({ ...EC }),
        listingAgent: () => s.setListingAgent({ ...EC }),
        lender: () => s.setLender({ ...EC }),
        mortgageBroker: () => setBroker({ ...EC }),
        escrowCompany: () => s.setEscrow({ ...EC }),
        escrowOfficer: () => s.setEscrowOfficer(''),
      };
      clears[key]();
    }
  }

  const officers = dedup(s.formOpts?.escrowOfficers ?? []);

  return (
    <div className={SECTION}>
      <p className={SH}>
        <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        Parties
      </p>

      {/* Checkboxes — driven by client type + order type */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
        {vis.buyerAgent && <Chk label="Buyer's Agent" checked={show.buyerAgent} onChange={v => toggle('buyerAgent', v)} />}
        {vis.listingAgent && <Chk label="Listing Agent" checked={show.listingAgent} onChange={v => toggle('listingAgent', v)} />}
        {vis.lender && <Chk label="Lender" checked={show.lender} onChange={v => toggle('lender', v)} />}
        {vis.mortgageBroker && <Chk label="Mortgage Broker" checked={show.mortgageBroker} onChange={v => toggle('mortgageBroker', v)} />}
        {vis.escrowCompany && <Chk label="Escrow Company" checked={show.escrowCompany} onChange={v => toggle('escrowCompany', v)} />}
        {vis.escrowOfficer && <Chk label="Escrow Officer" checked={show.escrowOfficer} onChange={v => toggle('escrowOfficer', v)} />}
      </div>

      {/* Buyer's Agent */}
      <Expand open={show.buyerAgent && vis.buyerAgent}>
        <ContactFields c={s.buyerAgent} set={s.setBuyerAgent} />
      </Expand>

      {/* Listing Agent */}
      <Expand open={show.listingAgent && vis.listingAgent}>
        <ContactFields c={s.listingAgent} set={s.setListingAgent} />
      </Expand>

      {/* Lender */}
      <Expand open={show.lender && vis.lender}>
        <ContactFields c={s.lender} set={s.setLender} companyFirst />
      </Expand>

      {/* Mortgage Broker (local state — Builder gap: add to hook + submission) */}
      <Expand open={show.mortgageBroker && vis.mortgageBroker}>
        <ContactFields c={broker} set={setBroker} />
      </Expand>

      {/* Escrow Company (external — Title Only / Sub Escrow) */}
      <Expand open={show.escrowCompany && vis.escrowCompany}>
        <ContactFields c={s.escrow} set={s.setEscrow} companyFirst />
      </Expand>

      {/* Escrow Officer (internal PCT — Title & Escrow / Escrow Only) */}
      <Expand open={show.escrowOfficer && vis.escrowOfficer}>
        <div className="mb-3">
          <label className={FL}>Escrow Officer</label>
          {officers.length ? (
            <select value={s.escrowOfficer} onChange={e => s.setEscrowOfficer(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {officers.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.escrowOfficer} onChange={e => s.setEscrowOfficer(e.target.value)} placeholder="Officer name" />
          )}
        </div>
      </Expand>

      {/* Deliverable Emails — always visible */}
      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Deliverable Emails</p>
          {s.deliverableEmails.length < 5 && (
            <button onClick={() => s.setDeliverableEmails([...s.deliverableEmails, ''])} className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] min-h-[36px]">+ Add</button>
          )}
        </div>
        {s.deliverableEmails.map((em, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input className={IN} type="email" value={em} onChange={e => { const arr = [...s.deliverableEmails]; arr[i] = e.target.value; s.setDeliverableEmails(arr); }} placeholder="email@example.com" />
            <button onClick={() => s.setDeliverableEmails(s.deliverableEmails.filter((_, j) => j !== i))} className="text-red-500 px-2 min-h-[36px]">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── UI Primitives ──────────────────────────────────────────────────────────

function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-[#F26B2B] focus:ring-[#F26B2B]/30" />
      <span className="text-sm font-medium text-[#1A1A2E]">{label}</span>
    </label>
  );
}

function Expand({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`transition-all duration-200 ease-in-out overflow-hidden ${open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
      <div className="pl-6 border-l-2 border-gray-200 mt-2 mb-4">{children}</div>
    </div>
  );
}
