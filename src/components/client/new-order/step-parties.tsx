'use client';

import { EMPTY, ORG_TYPES, SEL } from './types';
import { SH, FL, Nav, PF } from './shared';

export function StepParties({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  const upSeller = (f: string, v: string) => onChange({ ...data, seller: { ...data.seller, [f]: v } });
  const upBuyer = (f: string, v: string) => onChange({ ...data, buyer: { ...data.buyer, [f]: v } });
  return (
    <div className="p-5 sm:p-6">
      <SH title="Parties" sub="Buyer/borrower and seller information." />
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Seller</p>
        <PF person={data.seller} onChange={upSeller} />
        {!data.hasSecondary ? (
          <button onClick={() => onChange({ ...data, hasSecondary: true })} className="mt-2 text-xs text-[#1B2A4A] font-medium min-h-[44px]">+ Add secondary seller</button>
        ) : (
          <div className="mt-3 pl-3 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2"><p className="text-xs text-[#6B7280]">Secondary Seller</p><button onClick={() => onChange({ ...data, hasSecondary: false, secondarySeller: { ...EMPTY } })} className="text-xs text-red-500 min-h-[44px]">Remove</button></div>
            <PF person={data.secondarySeller} onChange={(f: string, v: string) => onChange({ ...data, secondarySeller: { ...data.secondarySeller, [f]: v } })} />
          </div>
        )}
      </div>
      <div className="border-t border-gray-100 pt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Buyer / Borrower</p>
          <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" checked={data.buyerIsOrg} onChange={(e) => onChange({ ...data, buyerIsOrg: e.target.checked })} className="rounded border-gray-300 text-[#1B2A4A] h-4 w-4" /><span className="text-xs text-[#6B7280]">Organization</span></label>
        </div>
        {data.buyerIsOrg && <div className="mb-3"><FL>Type</FL><select value={data.orgType} onChange={(e) => onChange({ ...data, orgType: e.target.value })} className={SEL}><option value="">Select…</option>{ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>}
        <PF person={data.buyer} onChange={upBuyer} />
        {!data.hasSecondaryBuyer ? (
          <button onClick={() => onChange({ ...data, hasSecondaryBuyer: true })} className="mt-2 text-xs text-[#1B2A4A] font-medium min-h-[44px]">+ Add secondary buyer</button>
        ) : (
          <div className="mt-3 pl-3 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2"><p className="text-xs text-[#6B7280]">Secondary Buyer</p><button onClick={() => onChange({ ...data, hasSecondaryBuyer: false, secondaryBuyer: { ...EMPTY } })} className="text-xs text-red-500 min-h-[44px]">Remove</button></div>
            <PF person={data.secondaryBuyer} onChange={(f: string, v: string) => onChange({ ...data, secondaryBuyer: { ...data.secondaryBuyer, [f]: v } })} />
          </div>
        )}
      </div>
      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}
