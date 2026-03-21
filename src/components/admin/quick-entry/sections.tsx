'use client';

import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { SECTION, SH, FL, IN, SEL, ORG_TYPES, TX_TYPES, EP } from './types';
import { PersonFields } from './person-fields';
import type { QuickEntryState } from './use-quick-entry';

export { PartiesSection } from './parties-section';

// ─── Property ───────────────────────────────────────────────────────────────

export function PropertySection({ s }: { s: QuickEntryState }) {
  return (
    <div className={SECTION}>
      <p className={SH}>
        <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        Property
      </p>
      <div className="flex gap-2 mb-4">
        <button onClick={() => s.setSearchMode('address')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${s.searchMode === 'address' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563]'}`}>Address</button>
        <button onClick={() => s.setSearchMode('apn')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${s.searchMode === 'apn' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563]'}`}>APN</button>
      </div>
      {/* Search input */}
      {s.searchMode === 'address' ? (
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <label className={FL}>Address</label>
            <AddressAutocomplete value={s.street} onChange={s.setStreet} onSelect={s.handleAddressSelect} placeholder="Start typing…" />
          </div>
          <button
            onClick={s.handleSearchClick}
            disabled={s.street.length <= 5}
            className={`self-end h-11 px-4 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors ${
              s.street.length > 5
                ? 'bg-[#F26B2B] text-white hover:bg-[#D85A1F]'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            Search Property
          </button>
        </div>
      ) : (
        <div className="flex gap-3 items-end mb-4">
          <div className="flex-1"><label className={FL}>APN</label><input className={IN} value={s.apn} onChange={(e) => s.setApn(e.target.value)} placeholder="1234-567-890" /></div>
          <div className="flex-1"><label className={FL}>County</label><input className={IN} value={s.county} onChange={(e) => s.setCounty(e.target.value)} placeholder="Los Angeles" /></div>
          <button onClick={s.handleApnSearch} disabled={!s.apn || !s.county || s.apnSearching} className="px-4 h-11 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">{s.apnSearching ? 'Searching…' : 'Search'}</button>
        </div>
      )}
      {s.noMatchMsg && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <p className="text-xs text-amber-700">{s.noMatchMsg}</p>
        </div>
      )}
      {s.siteXFilled && (
        <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-4">
          <svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          <p className="text-xs text-green-700 font-medium">Property details auto-filled</p>
        </div>
      )}
      {/* 2x2 detail grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div><label className={FL}>City</label><input className={IN} value={s.city} onChange={(e) => s.setCity(e.target.value)} /></div>
        <div><label className={FL}>State</label><input className={IN} value={s.state} onChange={(e) => s.setState(e.target.value)} /></div>
        <div><label className={FL}>ZIP</label><input className={IN} value={s.zip} onChange={(e) => s.setZip(e.target.value)} /></div>
        <div><label className={FL}>County</label><input className={IN} value={s.county} onChange={(e) => s.setCounty(e.target.value)} /></div>
        <div><label className={FL}>Property Type</label><input className={IN} value={s.propType} onChange={(e) => s.setPropType(e.target.value)} /></div>
        <div><label className={FL}>APN</label><input className={IN} value={s.apn} onChange={(e) => s.setApn(e.target.value)} /></div>
      </div>
      {/* Legal Description — full width */}
      <div><label className={FL}>Legal Description</label><textarea className={`${IN} resize-none`} rows={2} value={s.legalDesc} onChange={(e) => s.setLegalDesc(e.target.value)} /></div>
    </div>
  );
}

// ─── Seller ─────────────────────────────────────────────────────────────────

export function SellerSection({ s }: { s: QuickEntryState }) {
  return (
    <div className={SECTION}>
      <p className={SH}>
        <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        Seller
      </p>
      {s.sellerSiteX && (
        <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-3">
          <svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          <p className="text-xs text-green-700 font-medium">Auto-filled from property records</p>
        </div>
      )}
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-2 text-xs text-[#6B7280]">
          <input type="checkbox" checked={s.sellerIsOrg} onChange={(e) => s.setSellerIsOrg(e.target.checked)} className="rounded border-gray-300 text-[#F26B2B] h-4 w-4" /> Organization
        </label>
        {s.sellerIsOrg && (
          <select value={s.sellerOrgType} onChange={(e) => s.setSellerOrgType(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-xs">
            <option value="">Type…</option>
            {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      <PersonFields person={s.sellerPrimary} onChange={s.setSellerPrimary} label="Primary Seller" />
      {!s.hasSecondarySeller ? (
        <button onClick={() => s.setHasSecondarySeller(true)} className="text-xs font-medium text-[#1A1A2E] flex items-center gap-1 min-h-[36px]">+ Add secondary seller</button>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#6B7280]">Secondary Seller</span>
            <button onClick={() => { s.setHasSecondarySeller(false); s.setSellerSecondary({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button>
          </div>
          <PersonFields person={s.sellerSecondary} onChange={s.setSellerSecondary} label="" />
        </>
      )}
    </div>
  );
}

// ─── Transaction ────────────────────────────────────────────────────────────

export function TransactionSection({ s }: { s: QuickEntryState }) {
  return (
    <div className={SECTION}>
      <p className={SH}>
        <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
        Transaction
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={FL}>Transaction Type</label>
          <select value={s.txType} onChange={(e) => s.setTxType(e.target.value)} className={SEL}>
            {TX_TYPES.map((t) => <option key={t} value={t}>{t || 'Select…'}</option>)}
          </select>
        </div>
        <div>
          <label className={FL}>Product Type</label>
          {s.formOpts?.productTypes?.length ? (
            <select value={s.productType} onChange={(e) => s.setProductType(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {s.formOpts.productTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.productType} onChange={(e) => s.setProductType(e.target.value)} placeholder="Standard, Commercial…" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={FL}>Order Type</label>
          {s.formOpts?.orderTypes?.length ? (
            <select value={s.orderType} onChange={(e) => s.setOrderType(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {s.formOpts.orderTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.orderType} onChange={(e) => s.setOrderType(e.target.value)} />
          )}
        </div>
        <div><label className={FL}>Escrow Number</label><input className={IN} value={s.escrowNumber} onChange={(e) => s.setEscrowNumber(e.target.value)} placeholder="Optional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={FL}>Sales Rep</label>
          {s.formOpts?.salesReps?.length ? (
            <select value={s.salesRep} onChange={(e) => s.setSalesRep(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {s.formOpts.salesReps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.salesRep} onChange={(e) => s.setSalesRep(e.target.value)} />
          )}
        </div>
        <div>
          <label className={FL}>Title Officer</label>
          {s.formOpts?.titleOfficers?.length ? (
            <select value={s.titleOfficer} onChange={(e) => s.setTitleOfficer(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {s.formOpts.titleOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={s.titleOfficer} onChange={(e) => s.setTitleOfficer(e.target.value)} />
          )}
        </div>
      </div>
      {s.txType === 'Purchase' && (
        <div className="mb-3">
          <label className={FL}>Sales Amount</label>
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={s.salesAmount} onChange={(e) => s.setSalesAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div>
        </div>
      )}
      {s.txType === 'Refinance' && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={FL}>Loan Number</label><input className={IN} value={s.loanNumber} onChange={(e) => s.setLoanNumber(e.target.value)} /></div>
          <div><label className={FL}>Loan Amount</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={s.loanAmount} onChange={(e) => s.setLoanAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div></div>
        </div>
      )}
      <div className="mb-3"><label className={FL}>Coverage Amount</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={s.coverageAmount} onChange={(e) => s.setCoverageAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div></div>
      {(s.txType === 'Purchase' || s.txType === 'Refinance') && (
        <div className="border-t border-gray-100 pt-3">
          <PersonFields person={s.borrower} onChange={s.setBorrower} label="Primary Borrower" />
          {s.txType === 'Purchase' && !s.hasSecBorrower && (
            <button onClick={() => s.setHasSecBorrower(true)} className="text-xs font-medium text-[#1A1A2E] flex items-center gap-1 min-h-[36px]">+ Add secondary borrower</button>
          )}
          {s.txType === 'Purchase' && s.hasSecBorrower && (
            <>
              <div className="flex items-center justify-between"><span className="text-xs text-[#6B7280]">Secondary Borrower</span><button onClick={() => { s.setHasSecBorrower(false); s.setSecBorrower({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button></div>
              <PersonFields person={s.secBorrower} onChange={s.setSecBorrower} label="" />
            </>
          )}
          <label className="flex items-center gap-2 text-xs text-[#6B7280] mt-2">
            <input type="checkbox" checked={s.borrowerIsOrg} onChange={(e) => s.setBorrowerIsOrg(e.target.checked)} className="rounded border-gray-300 text-[#F26B2B] h-4 w-4" /> Borrower is an organization
          </label>
          {s.borrowerIsOrg && (
            <select value={s.borrowerOrgType} onChange={(e) => s.setBorrowerOrgType(e.target.value)} className="mt-2 h-9 px-2 border border-gray-200 rounded-lg text-xs">
              <option value="">Type…</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

