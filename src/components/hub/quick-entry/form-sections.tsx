'use client';

import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { PersonFields } from '@/components/admin/quick-entry/person-fields';
import { ORG_TYPES, TX_TYPES, EP, IN, SEL, FL } from '@/components/admin/quick-entry/types';
import type { QuickEntryState } from '@/components/admin/quick-entry/use-quick-entry';
import { CurrencyInput } from './shared';

export function PropertySearch({ s }: { s: QuickEntryState }) {
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => s.setSearchMode('address')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${s.searchMode === 'address' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563] hover:bg-gray-200'}`}>Address</button>
        <button onClick={() => s.setSearchMode('apn')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${s.searchMode === 'apn' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563] hover:bg-gray-200'}`}>APN</button>
      </div>
      {s.searchMode === 'address' ? (
        <div className="flex gap-2 mb-4">
          <div className="flex-1"><label className={FL}>Address</label><AddressAutocomplete value={s.street} onChange={s.setStreet} onSelect={s.handleAddressSelect} placeholder="Start typing an address…" /></div>
          <button onClick={s.handleSearchClick} disabled={!s.street || !s.city} className="self-end px-4 h-11 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">Search</button>
        </div>
      ) : (
        <div className="flex gap-3 items-end mb-4">
          <div className="flex-1"><label className={FL}>APN</label><input className={IN} value={s.apn} onChange={e => s.setApn(e.target.value)} placeholder="1234-567-890" /></div>
          <div className="flex-1"><label className={FL}>County</label><input className={IN} value={s.county} onChange={e => s.setCounty(e.target.value)} placeholder="Los Angeles" /></div>
          <button onClick={s.handleApnSearch} disabled={!s.apn || !s.county || s.apnSearching} className="px-4 h-11 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors shrink-0">{s.apnSearching ? 'Searching…' : 'Search'}</button>
        </div>
      )}
      {s.noMatchMsg && <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-3 text-xs text-amber-700">{s.noMatchMsg}</div>}
      {s.siteXFilled && <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-3"><svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg><p className="text-xs text-green-700 font-medium">Property details auto-filled from county records</p></div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={FL}>City</label><input className={IN} value={s.city} onChange={e => s.setCity(e.target.value)} /></div>
        <div><label className={FL}>State</label><input className={IN} value={s.state} onChange={e => s.setState(e.target.value)} /></div>
        <div><label className={FL}>ZIP</label><input className={IN} value={s.zip} onChange={e => s.setZip(e.target.value)} /></div>
        <div><label className={FL}>County</label><input className={IN} value={s.county} onChange={e => s.setCounty(e.target.value)} /></div>
        <div><label className={FL}>Property Type</label><input className={IN} value={s.propType} onChange={e => s.setPropType(e.target.value)} /></div>
        <div><label className={FL}>APN</label><input className={IN} value={s.apn} onChange={e => s.setApn(e.target.value)} /></div>
        <div className="col-span-2"><label className={FL}>Legal Description</label><textarea className={`${IN} resize-none`} rows={2} value={s.legalDesc} onChange={e => s.setLegalDesc(e.target.value)} /></div>
      </div>
    </div>
  );
}

export function SellerFields({ s }: { s: QuickEntryState }) {
  return (
    <div>
      {s.sellerSiteX && <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-3"><svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg><p className="text-xs text-green-700 font-medium">Auto-filled from property records</p></div>}
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-2 text-xs text-[#6B7280] cursor-pointer">
          <input type="checkbox" checked={s.sellerIsOrg} onChange={e => s.setSellerIsOrg(e.target.checked)} className="rounded border-gray-300 accent-[#F26B2B] h-4 w-4" /> Organization
        </label>
        {s.sellerIsOrg && (
          <select value={s.sellerOrgType} onChange={e => s.setSellerOrgType(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-[#F26B2B]">
            <option value="">Type…</option>
            {ORG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      {s.sellerIsOrg ? (
        <div className="mb-3"><label className={FL}>Organization Name</label><input className={IN} value={s.sellerPrimary.firstName} onChange={e => s.setSellerPrimary({ ...s.sellerPrimary, firstName: e.target.value })} placeholder="Company / Trust name" /></div>
      ) : (
        <PersonFields person={s.sellerPrimary} onChange={s.setSellerPrimary} label="Primary Seller" />
      )}
      {!s.hasSecondarySeller ? (
        <button onClick={() => s.setHasSecondarySeller(true)} className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] flex items-center gap-1 min-h-[36px]">+ Add secondary seller</button>
      ) : (
        <>
          <div className="flex items-center justify-between mt-2"><span className="text-xs text-[#6B7280]">Secondary Seller</span><button onClick={() => { s.setHasSecondarySeller(false); s.setSellerSecondary({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button></div>
          <PersonFields person={s.sellerSecondary} onChange={s.setSellerSecondary} label="" />
        </>
      )}
    </div>
  );
}

export function TransactionFields({ s }: { s: QuickEntryState }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className={FL}>Transaction Type</label><select value={s.txType} onChange={e => s.setTxType(e.target.value)} className={SEL}>{TX_TYPES.map(t => <option key={t} value={t}>{t || 'Select…'}</option>)}</select></div>
        <div><label className={FL}>Product Type</label>{s.formOpts?.productTypes?.length ? <select value={s.productType} onChange={e => s.setProductType(e.target.value)} className={SEL}><option value="">Select…</option>{s.formOpts.productTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={IN} value={s.productType} onChange={e => s.setProductType(e.target.value)} />}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className={FL}>Order Type</label>{s.formOpts?.orderTypes?.length ? <select value={s.orderType} onChange={e => s.setOrderType(e.target.value)} className={SEL}><option value="">Select…</option>{s.formOpts.orderTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={IN} value={s.orderType} onChange={e => s.setOrderType(e.target.value)} />}</div>
        <div><label className={FL}>Escrow Number</label><input className={IN} value={s.escrowNumber} onChange={e => s.setEscrowNumber(e.target.value)} placeholder="Optional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className={FL}>Sales Rep</label>{s.formOpts?.salesReps?.length ? <select value={s.salesRep} onChange={e => s.setSalesRep(e.target.value)} className={SEL}><option value="">Select…</option>{s.formOpts.salesReps.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={IN} value={s.salesRep} onChange={e => s.setSalesRep(e.target.value)} />}</div>
        <div><label className={FL}>Title Officer</label>{s.formOpts?.titleOfficers?.length ? <select value={s.titleOfficer} onChange={e => s.setTitleOfficer(e.target.value)} className={SEL}><option value="">Select…</option>{s.formOpts.titleOfficers.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={IN} value={s.titleOfficer} onChange={e => s.setTitleOfficer(e.target.value)} />}</div>
      </div>
      {s.txType === 'Purchase' && <div className="mb-3"><label className={FL}>Sales Amount</label><CurrencyInput value={s.salesAmount} onChange={s.setSalesAmount} /></div>}
      {s.txType === 'Refinance' && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={FL}>Loan Number</label><input className={IN} value={s.loanNumber} onChange={e => s.setLoanNumber(e.target.value)} /></div>
          <div><label className={FL}>Loan Amount</label><CurrencyInput value={s.loanAmount} onChange={s.setLoanAmount} /></div>
        </div>
      )}
      <div className="mb-3"><label className={FL}>Coverage Amount</label><CurrencyInput value={s.coverageAmount} onChange={s.setCoverageAmount} /></div>
      {(s.txType === 'Purchase' || s.txType === 'Refinance') && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <PersonFields person={s.borrower} onChange={s.setBorrower} label="Primary Borrower" />
          {s.txType === 'Purchase' && !s.hasSecBorrower && <button onClick={() => s.setHasSecBorrower(true)} className="text-xs font-medium text-[#F26B2B] flex items-center gap-1 min-h-[36px]">+ Add secondary borrower</button>}
          {s.txType === 'Purchase' && s.hasSecBorrower && (
            <>
              <div className="flex items-center justify-between"><span className="text-xs text-[#6B7280]">Secondary Borrower</span><button onClick={() => { s.setHasSecBorrower(false); s.setSecBorrower({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button></div>
              <PersonFields person={s.secBorrower} onChange={s.setSecBorrower} label="" />
            </>
          )}
          <label className="flex items-center gap-2 text-xs text-[#6B7280] mt-2 cursor-pointer">
            <input type="checkbox" checked={s.borrowerIsOrg} onChange={e => s.setBorrowerIsOrg(e.target.checked)} className="rounded border-gray-300 accent-[#F26B2B] h-4 w-4" /> Borrower is an organization
          </label>
          {s.borrowerIsOrg && <select value={s.borrowerOrgType} onChange={e => s.setBorrowerOrgType(e.target.value)} className="mt-2 h-9 px-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-[#F26B2B]"><option value="">Type…</option>{ORG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>}
        </div>
      )}
    </div>
  );
}
