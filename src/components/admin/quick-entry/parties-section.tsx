'use client';

import { useState, useEffect, useRef } from 'react';
import { partyHasInput } from '@/lib/domain/orders/party-contact';
import { ContactFields } from './contact-fields';
import { SECTION, SH, FL, IN, SEL, EC } from './types';
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

  const isListingClient = c === 'listing agent';
  const isEscrowClient = ['escrow company', 'escrow officer', 'escrow'].includes(c);
  const isRefiLike = t === 'refinance' || t === 'equity';

  const extEscrow = ['title only', 'title_only', 'sub escrow', 'sub_escrow', ''].includes(o);
  const intEscrow = ['title & escrow', 'title_escrow', 'escrow only', 'escrow_only'].includes(o);

  return {
    buyerAgent: !['agent', 'listing agent'].includes(c) && !isRefiLike,
    listingAgent: !isListingClient && !isRefiLike,
    lender: c !== 'lender',
    mortgageBroker: c !== 'mortgage broker',
    escrowCompany: extEscrow && !isEscrowClient,
    escrowOfficer: intEscrow,
    seller: t === 'purchase' || t === 'other' || !t,
    borrower: t === 'purchase' || t === 'refinance' || t === 'equity' || t === 'other' || !t,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasData(c: Parameters<typeof partyHasInput>[0]): boolean { return partyHasInput(c); }

function dedup(opts: { value: string; label: string }[]) {
  const seen = new Set<string>();
  return opts.filter(o => { const k = o.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

type ShowState = Record<'buyerAgent' | 'listingAgent' | 'lender' | 'mortgageBroker' | 'escrowCompany' | 'escrowOfficer', boolean>;
type PK = keyof ShowState;

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
    mortgageBroker: hasData(s.mortgageBroker),
    escrowCompany: hasData(s.escrow),
    escrowOfficer: !!s.escrowOfficer,
  }));

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
    if (pv.mortgageBroker && !nv.mortgageBroker) s.setMortgageBroker({ ...EC });
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
        mortgageBroker: () => s.setMortgageBroker({ ...EC }),
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
        <ContactFields c={s.buyerAgent} set={s.setBuyerAgent} searchRole="buyer_agent" label="Buyer's Agent" />
      </Expand>

      {/* Listing Agent */}
      <Expand open={show.listingAgent && vis.listingAgent}>
        <ContactFields c={s.listingAgent} set={s.setListingAgent} searchRole="listing_agent" label="Listing Agent" />
      </Expand>

      {/* Lender */}
      <Expand open={show.lender && vis.lender}>
        <ContactFields c={s.lender} set={s.setLender} companyFirst searchRole="lender" label="Lender" />
      </Expand>

      {/* Mortgage Broker */}
      <Expand open={show.mortgageBroker && vis.mortgageBroker}>
        <ContactFields c={s.mortgageBroker} set={s.setMortgageBroker} searchRole="mortgage_broker" label="Mortgage Broker" />
      </Expand>

      {/* Escrow Company (external — Title Only / Sub Escrow) */}
      <Expand open={show.escrowCompany && vis.escrowCompany}>
        <ContactFields c={s.escrow} set={s.setEscrow} companyFirst searchRole="escrow" label="Escrow Company" />
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

      {/* Deliverable Emails removed — the addresses were never persisted, never sent
          to SoftPro, and read by no recipient resolver. See
          docs/tickets/DELIVERABLE_EMAILS.md for the design when it is built. */}
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
  if (!open) return null;
  return (
    <div className="pl-6 border-l-2 border-gray-200 mt-2 mb-4 relative z-10">
      {children}
    </div>
  );
}
