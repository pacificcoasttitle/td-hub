'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { SECTION, SH, FL, IN, SEL, EC } from './types';
import type { QuickEntryState } from './use-quick-entry';

function hasContactData(c: { name: string; company: string }): boolean {
  return !!(c.name || c.company);
}

const ESCROW_CLIENT_TYPES = ['escrow company', 'escrow officer'];
const LENDER_CLIENT_TYPES = ['lender'];
const ESCROW_ORDER_TYPES = ['title & escrow', 'escrow only'];

function partyVisibility(ct: string | null | undefined, ot: string) {
  const clientLower = (ct ?? '').toLowerCase().trim();
  const orderLower = ot.toLowerCase().trim();
  const escrowByOrder = !orderLower || ESCROW_ORDER_TYPES.includes(orderLower);
  return {
    buyer: true,
    lender: !ESCROW_CLIENT_TYPES.includes(clientLower),
    escrow: !LENDER_CLIENT_TYPES.includes(clientLower) && escrowByOrder,
  };
}

export function PartiesSection({ s }: { s: QuickEntryState }) {
  const clientType = s.client?.contactType ?? null;
  const orderType = s.orderType ?? '';
  const vis = partyVisibility(clientType, orderType);

  const [showBuyer, setShowBuyer] = useState(() => hasContactData(s.buyerAgent));
  const [showLender, setShowLender] = useState(() => hasContactData(s.lender));
  const [showEscrow, setShowEscrow] = useState(() => !!(hasContactData(s.escrow) || s.escrowOfficer));

  const prevClient = useRef(clientType);
  const prevOrder = useRef(orderType);
  useEffect(() => {
    if (prevClient.current === clientType && prevOrder.current === orderType) return;
    prevClient.current = clientType;
    prevOrder.current = orderType;
    const v = partyVisibility(clientType, orderType);
    if (!v.lender && showLender) { setShowLender(false); s.setLender({ ...EC }); }
    if (!v.escrow && showEscrow) { setShowEscrow(false); s.setEscrow({ ...EC }); s.setEscrowOfficer(''); }
  }, [clientType, orderType, showLender, showEscrow, s]);

  const toggleBuyer = useCallback((on: boolean) => {
    setShowBuyer(on);
    if (!on) s.setBuyerAgent({ ...EC });
  }, [s]);
  const toggleLender = useCallback((on: boolean) => {
    setShowLender(on);
    if (!on) s.setLender({ ...EC });
  }, [s]);
  const toggleEscrow = useCallback((on: boolean) => {
    setShowEscrow(on);
    if (!on) { s.setEscrow({ ...EC }); s.setEscrowOfficer(''); }
  }, [s]);

  return (
    <div className={SECTION}>
      <p className={SH}>
        <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        Parties
      </p>

      {/* Checkboxes — visibility driven by client type */}
      <div className="flex items-center gap-6 mb-4">
        {vis.buyer && <Toggle label="Buyer / Borrower" checked={showBuyer} onChange={toggleBuyer} />}
        {vis.lender && <Toggle label="Lender" checked={showLender} onChange={toggleLender} />}
        {vis.escrow && <Toggle label="Escrow Officer" checked={showEscrow} onChange={toggleEscrow} />}
      </div>

      {/* Buyer / Borrower */}
      <Expand open={showBuyer}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Buyer / Borrower</p>
        <div className="mb-3"><label className={FL}>Name</label><input className={IN} value={s.buyerAgent.name} onChange={(e) => s.setBuyerAgent({ ...s.buyerAgent, name: e.target.value })} placeholder="Full name" /></div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div><label className={FL}>Email</label><input className={IN} type="email" value={s.buyerAgent.email} onChange={(e) => s.setBuyerAgent({ ...s.buyerAgent, email: e.target.value })} /></div>
          <div><label className={FL}>Phone</label><input className={IN} type="tel" value={s.buyerAgent.phone} onChange={(e) => s.setBuyerAgent({ ...s.buyerAgent, phone: e.target.value })} /></div>
        </div>
        <div className="mb-3"><label className={FL}>Company</label><input className={IN} value={s.buyerAgent.company} onChange={(e) => s.setBuyerAgent({ ...s.buyerAgent, company: e.target.value })} /></div>
      </Expand>

      {/* Lender */}
      <Expand open={showLender}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Lender</p>
        <div className="mb-3"><label className={FL}>Company Name</label><input className={IN} value={s.lender.company} onChange={(e) => s.setLender({ ...s.lender, company: e.target.value })} /></div>
        <div className="mb-3"><label className={FL}>Contact Name</label><input className={IN} value={s.lender.name} onChange={(e) => s.setLender({ ...s.lender, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div><label className={FL}>Email</label><input className={IN} type="email" value={s.lender.email} onChange={(e) => s.setLender({ ...s.lender, email: e.target.value })} /></div>
          <div><label className={FL}>Phone</label><input className={IN} type="tel" value={s.lender.phone} onChange={(e) => s.setLender({ ...s.lender, phone: e.target.value })} /></div>
        </div>
      </Expand>

      {/* Escrow Officer */}
      <Expand open={showEscrow}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Escrow Officer</p>
        <div className="mb-3">
          <label className={FL}>Name</label>
          {s.formOpts?.escrowOfficers?.length ? (
            <select value={s.escrowOfficer} onChange={(e) => s.setEscrowOfficer(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {s.formOpts.escrowOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.escrow.name} onChange={(e) => s.setEscrow({ ...s.escrow, name: e.target.value })} placeholder="Escrow officer name" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div><label className={FL}>Email</label><input className={IN} type="email" value={s.escrow.email} onChange={(e) => s.setEscrow({ ...s.escrow, email: e.target.value })} /></div>
          <div><label className={FL}>Phone</label><input className={IN} type="tel" value={s.escrow.phone} onChange={(e) => s.setEscrow({ ...s.escrow, phone: e.target.value })} /></div>
        </div>
        <div className="mb-3"><label className={FL}>Company</label><input className={IN} value={s.escrow.company} onChange={(e) => s.setEscrow({ ...s.escrow, company: e.target.value })} /></div>
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
            <input className={IN} type="email" value={em} onChange={(e) => { const arr = [...s.deliverableEmails]; arr[i] = e.target.value; s.setDeliverableEmails(arr); }} placeholder="email@example.com" />
            <button onClick={() => s.setDeliverableEmails(s.deliverableEmails.filter((_, j) => j !== i))} className="text-red-500 px-2 min-h-[36px]">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-[#F26B2B] focus:ring-[#F26B2B]/30" />
      <span className="text-sm font-medium text-[#1A1A2E]">{label}</span>
    </label>
  );
}

function Expand({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`transition-all duration-200 ease-in-out overflow-hidden ${open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
      <div className="pl-6 border-l-2 border-gray-200 mt-2 mb-4">
        {children}
      </div>
    </div>
  );
}
