'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClientSelector, type ClientContact } from '@/components/admin/client-selector';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import { PropertyConfirmModal, type SiteXPropertyResult } from '@/components/shared/property-confirm-modal';

const GOLD = '#C5A55A';
const NAVY = '#1B2A4A';

const IN = 'w-full h-11 px-3 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/30 focus:border-[#C5A55A] bg-white';
const SEL = IN;
const SECTION = 'bg-white border border-gray-200 rounded-xl p-6 mb-6';
const SH = 'text-base font-semibold text-[#1A1A2E] mb-4 flex items-center gap-2';
const FL = 'block text-sm font-medium text-[#1A1A2E] mb-1';

const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];
const TX_TYPES = ['', 'Purchase', 'Refinance', 'Equity', 'Other'];

interface Person { firstName: string; middleName: string; lastName: string; }
interface PartyContact { name: string; email: string; phone: string; company: string; }
interface FormOption { value: string; label: string; }

const EP: Person = { firstName: '', middleName: '', lastName: '' };
const EC: PartyContact = { name: '', email: '', phone: '', company: '' };

export default function QuickEntryPage() {
  const [client, setClient] = useState<ClientContact | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAddress, setPendingAddress] = useState<ParsedAddress | null>(null);
  const [noMatchMsg, setNoMatchMsg] = useState('');
  const [apnSearching, setApnSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'address' | 'apn'>('address');

  // Property
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [apn, setApn] = useState('');
  const [county, setCounty] = useState('');
  const [legalDesc, setLegalDesc] = useState('');
  const [propType, setPropType] = useState('');
  const [siteXFilled, setSiteXFilled] = useState(false);

  // Seller
  const [sellerPrimary, setSellerPrimary] = useState<Person>({ ...EP });
  const [sellerSecondary, setSellerSecondary] = useState<Person>({ ...EP });
  const [hasSecondarySeller, setHasSecondarySeller] = useState(false);
  const [sellerIsOrg, setSellerIsOrg] = useState(false);
  const [sellerOrgType, setSellerOrgType] = useState('');
  const [sellerSiteX, setSellerSiteX] = useState(false);

  // Transaction
  const [txType, setTxType] = useState('');
  const [productType, setProductType] = useState('');
  const [orderType, setOrderType] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [titleOfficer, setTitleOfficer] = useState('');
  const [escrowNumber, setEscrowNumber] = useState('');
  const [salesAmount, setSalesAmount] = useState('');
  const [loanNumber, setLoanNumber] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [coverageAmount, setCoverageAmount] = useState('');
  const [borrower, setBorrower] = useState<Person>({ ...EP });
  const [secBorrower, setSecBorrower] = useState<Person>({ ...EP });
  const [hasSecBorrower, setHasSecBorrower] = useState(false);
  const [borrowerIsOrg, setBorrowerIsOrg] = useState(false);
  const [borrowerOrgType, setBorrowerOrgType] = useState('');

  // Parties
  const [buyerAgent, setBuyerAgent] = useState<PartyContact>({ ...EC });
  const [listingAgent, setListingAgent] = useState<PartyContact>({ ...EC });
  const [lender, setLender] = useState<PartyContact>({ ...EC });
  const [escrow, setEscrow] = useState<PartyContact>({ ...EC });
  const [escrowOfficer, setEscrowOfficer] = useState('');
  const [deliverableEmails, setDeliverableEmails] = useState<string[]>([]);

  // Form options
  const [formOpts, setFormOpts] = useState<{
    productTypes: FormOption[]; orderTypes: FormOption[];
    salesReps: FormOption[]; titleOfficers: FormOption[];
    escrowOfficers: FormOption[];
  } | null>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; orderId?: number } | null>(null);

  useEffect(() => {
    fetch('/api/form-options')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const toOpt = (arr: Array<{ id?: number; name?: string; value?: string; label?: string; email?: string }>) =>
          (arr ?? []).map((r) => ({ value: r.value ?? String(r.id ?? ''), label: r.label ?? r.name ?? r.email ?? '' }));
        setFormOpts({
          productTypes: d.productTypes ?? [],
          orderTypes: d.orderTypes ?? [],
          salesReps: toOpt(d.salesReps),
          titleOfficers: toOpt(d.titleOfficers),
          escrowOfficers: toOpt(d.escrowOfficers),
        });
      })
      .catch(() => {});
  }, []);

  function handleAddressSelect(parsed: ParsedAddress) {
    setPendingAddress(parsed);
    setStreet(parsed.street); setCity(parsed.city); setState(parsed.state); setZip(parsed.zip);
    setShowConfirmModal(true);
    setNoMatchMsg('');
  }

  function handleSearchClick() {
    if (street && city && state && zip) {
      setPendingAddress({ street, city, state, zip, placeId: '' });
      setShowConfirmModal(true);
      setNoMatchMsg('');
    }
  }

  function handleConfirm(p: SiteXPropertyResult) {
    setShowConfirmModal(false);
    if (p.apn) setApn(p.apn);
    if (p.county) setCounty(p.county);
    if (p.legalDescription) setLegalDesc(p.legalDescription);
    if (p.propertyType) setPropType(p.propertyType);
    if (p.fullAddress) setStreet(p.fullAddress);
    if (p.city) setCity(p.city);
    if (p.state) setState(p.state);
    if (p.zip) setZip(p.zip);
    setSiteXFilled(true);
    fillOwners(p);
  }

  function fillOwners(p: SiteXPropertyResult) {
    if (p.primaryOwner) {
      const parts = p.primaryOwner.split(' ');
      setSellerPrimary({ firstName: parts[0] ?? '', middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '', lastName: parts.length > 1 ? parts[parts.length - 1] : '' });
      setSellerSiteX(true);
    }
    if (p.secondaryOwner) {
      const parts = p.secondaryOwner.split(' ');
      setSellerSecondary({ firstName: parts[0] ?? '', middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '', lastName: parts.length > 1 ? parts[parts.length - 1] : '' });
      setHasSecondarySeller(true);
      setSellerSiteX(true);
    }
  }

  async function handleApnSearch() {
    if (!apn || !county) return;
    setApnSearching(true);
    setNoMatchMsg('');
    try {
      const res = await fetch('/api/property/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apn', apn, county }),
      });
      const data = await res.json();
      if (data.match === 'single' && data.property) {
        const p = data.property;
        if (p.fullAddress) setStreet(p.fullAddress);
        if (p.city) setCity(p.city);
        if (p.state) setState(p.state);
        if (p.zip) setZip(p.zip);
        if (p.county) setCounty(p.county);
        if (p.legalDescription) setLegalDesc(p.legalDescription);
        if (p.propertyType) setPropType(p.propertyType);
        setSiteXFilled(true);
        fillOwners(p);
      } else {
        setNoMatchMsg('No property found for this APN.');
      }
    } catch {
      setNoMatchMsg('Search failed.');
    } finally {
      setApnSearching(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const payload = {
        clientId: client?.id,
        property: { street, city, state, zip, apn, county, legalDescription: legalDesc, propertyType: propType },
        seller: { primary: sellerPrimary, secondary: hasSecondarySeller ? sellerSecondary : undefined, isOrg: sellerIsOrg, orgType: sellerOrgType },
        transaction: { transactionType: txType, productType, orderType, salesRep, titleOfficer, escrowNumber, salesAmount, loanNumber, loanAmount, coverageAmount },
        borrower: { primary: borrower, secondary: hasSecBorrower ? secBorrower : undefined, isOrg: borrowerIsOrg, orgType: borrowerOrgType },
        parties: { buyerAgent, listingAgent, lender, escrow, escrowOfficer },
        deliverableEmails: deliverableEmails.filter(Boolean),
      };
      const res = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Creation failed (${res.status})`);
      setResult({ type: 'success', message: `Order ${body.fileNumber ?? body.orderId ?? ''} created.`, orderId: body.orderId ?? body.id });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  function PersonFields({ person, onChange, label }: { person: Person; onChange: (p: Person) => void; label: string }) {
    return (
      <>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className={FL}>First</label><input className={IN} value={person.firstName} onChange={(e) => onChange({ ...person, firstName: e.target.value })} /></div>
          <div><label className={FL}>Middle</label><input className={IN} value={person.middleName} onChange={(e) => onChange({ ...person, middleName: e.target.value })} /></div>
          <div><label className={FL}>Last</label><input className={IN} value={person.lastName} onChange={(e) => onChange({ ...person, lastName: e.target.value })} /></div>
        </div>
      </>
    );
  }

  function ContactFields({ contact, onChange, label, searchRole, companyFirst }: { contact: PartyContact; onChange: (c: PartyContact) => void; label: string; searchRole: string; companyFirst?: boolean }) {
    return (
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={FL}>{companyFirst ? 'Company' : 'Name'}</label><input className={IN} value={companyFirst ? contact.company : contact.name} onChange={(e) => onChange({ ...contact, [companyFirst ? 'company' : 'name']: e.target.value })} /></div>
          <div><label className={FL}>{companyFirst ? 'Contact Name' : 'Company'}</label><input className={IN} value={companyFirst ? contact.name : contact.company} onChange={(e) => onChange({ ...contact, [companyFirst ? 'name' : 'company']: e.target.value })} /></div>
          <div><label className={FL}>Email</label><input className={IN} type="email" value={contact.email} onChange={(e) => onChange({ ...contact, email: e.target.value })} /></div>
          <div><label className={FL}>Phone</label><input className={IN} type="tel" value={contact.phone} onChange={(e) => onChange({ ...contact, phone: e.target.value })} /></div>
        </div>
      </div>
    );
  }

  if (result?.type === 'success' && result.orderId) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-[#1B2A4A] px-6 py-5 flex items-center gap-3">
            <svg className="h-6 w-6 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="text-white font-semibold">Order Created</p>
              <p className="text-white/60 text-sm">{result.message}</p>
            </div>
          </div>
          <div className="p-6 flex gap-3">
            <Link href={`/orders/${result.orderId}`} className="flex-1 inline-flex items-center justify-center px-5 py-3 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#B8953D] transition-colors h-11">
              View Order
            </Link>
            <button onClick={() => { setResult(null); window.scrollTo(0, 0); }} className="flex-1 inline-flex items-center justify-center px-5 py-3 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors h-11">
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto pb-32">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Quick Entry</h1>
        <p className="text-sm text-[#6B7280] mt-1">Create an order on behalf of a client — all fields in one view.</p>
      </div>

      {/* Client Selector */}
      <div className={SECTION}>
        <p className={SH}>
          <svg className="h-5 w-5 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          Client
        </p>
        <ClientSelector
          selected={client}
          onSelect={setClient}
          onClear={() => setClient(null)}
        />
        {client && (
          <div className="mt-3 px-4 py-3 bg-[#C5A55A]/10 border border-[#C5A55A]/20 rounded-lg">
            <p className="text-sm font-medium text-[#1A1A2E]">Opening on behalf of: {client.fullName ?? client.companyName ?? 'Client'}</p>
            <p className="text-xs text-[#6B7280]">{[client.email, client.phone].filter(Boolean).join(' · ')}</p>
          </div>
        )}
      </div>

      {/* Property */}
      <div className={SECTION}>
        <p className={SH}>
          <svg className="h-5 w-5 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Property
        </p>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setSearchMode('address')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${searchMode === 'address' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563]'}`}>Address</button>
          <button onClick={() => setSearchMode('apn')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${searchMode === 'apn' ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-[#4B5563]'}`}>APN</button>
        </div>
        {searchMode === 'address' ? (
          <>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className={FL}>Address</label>
                <AddressAutocomplete value={street} onChange={setStreet} onSelect={handleAddressSelect} placeholder="Start typing…" />
              </div>
              <button onClick={handleSearchClick} disabled={!street || !city} className="self-end px-4 h-11 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#B8953D] disabled:opacity-50 transition-colors">Search</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><label className={FL}>City</label><input className={IN} value={city} onChange={(e) => setCity(e.target.value)} /></div>
              <div><label className={FL}>State</label><input className={IN} value={state} onChange={(e) => setState(e.target.value)} /></div>
              <div><label className={FL}>ZIP</label><input className={IN} value={zip} onChange={(e) => setZip(e.target.value)} /></div>
            </div>
          </>
        ) : (
          <div className="flex gap-3 items-end mb-3">
            <div className="flex-1"><label className={FL}>APN</label><input className={IN} value={apn} onChange={(e) => setApn(e.target.value)} placeholder="1234-567-890" /></div>
            <div className="flex-1"><label className={FL}>County</label><input className={IN} value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Los Angeles" /></div>
            <button onClick={handleApnSearch} disabled={!apn || !county || apnSearching} className="px-4 h-11 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#B8953D] disabled:opacity-50 transition-colors">{apnSearching ? 'Searching…' : 'Search'}</button>
          </div>
        )}
        {noMatchMsg && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-3">
            <p className="text-xs text-amber-700">{noMatchMsg}</p>
          </div>
        )}
        {siteXFilled && (
          <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-3">
            <svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            <p className="text-xs text-green-700 font-medium">Property details auto-filled</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={FL}>County</label><input className={IN} value={county} onChange={(e) => setCounty(e.target.value)} /></div>
          <div><label className={FL}>APN</label><input className={IN} value={apn} onChange={(e) => setApn(e.target.value)} /></div>
          <div><label className={FL}>Property Type</label><input className={IN} value={propType} onChange={(e) => setPropType(e.target.value)} /></div>
        </div>
        <div><label className={FL}>Legal Description</label><textarea className={`${IN} resize-none`} rows={2} value={legalDesc} onChange={(e) => setLegalDesc(e.target.value)} /></div>
      </div>

      {/* Seller */}
      <div className={SECTION}>
        <p className={SH}>
          <svg className="h-5 w-5 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
          Seller
        </p>
        {sellerSiteX && (
          <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg mb-3">
            <svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            <p className="text-xs text-green-700 font-medium">Auto-filled from property records</p>
          </div>
        )}
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 text-xs text-[#6B7280]">
            <input type="checkbox" checked={sellerIsOrg} onChange={(e) => setSellerIsOrg(e.target.checked)} className="rounded border-gray-300 text-[#C5A55A] h-4 w-4" /> Organization
          </label>
          {sellerIsOrg && (
            <select value={sellerOrgType} onChange={(e) => setSellerOrgType(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-xs">
              <option value="">Type…</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        <PersonFields person={sellerPrimary} onChange={setSellerPrimary} label="Primary Seller" />
        {!hasSecondarySeller ? (
          <button onClick={() => setHasSecondarySeller(true)} className="text-xs font-medium text-[#1A1A2E] flex items-center gap-1 min-h-[36px]">+ Add secondary seller</button>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6B7280]">Secondary Seller</span>
              <button onClick={() => { setHasSecondarySeller(false); setSellerSecondary({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button>
            </div>
            <PersonFields person={sellerSecondary} onChange={setSellerSecondary} label="" />
          </>
        )}
      </div>

      {/* Transaction */}
      <div className={SECTION}>
        <p className={SH}>
          <svg className="h-5 w-5 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
          Transaction
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={FL}>Transaction Type</label>
            <select value={txType} onChange={(e) => setTxType(e.target.value)} className={SEL}>
              {TX_TYPES.map((t) => <option key={t} value={t}>{t || 'Select…'}</option>)}
            </select>
          </div>
          <div>
            <label className={FL}>Product Type</label>
            {formOpts?.productTypes?.length ? (
              <select value={productType} onChange={(e) => setProductType(e.target.value)} className={SEL}>
                <option value="">Select…</option>
                {formOpts.productTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Standard, Commercial…" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={FL}>Order Type</label>
            {formOpts?.orderTypes?.length ? (
              <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={SEL}>
                <option value="">Select…</option>
                {formOpts.orderTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={orderType} onChange={(e) => setOrderType(e.target.value)} />
            )}
          </div>
          <div><label className={FL}>Escrow Number</label><input className={IN} value={escrowNumber} onChange={(e) => setEscrowNumber(e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={FL}>Sales Rep</label>
            {formOpts?.salesReps?.length ? (
              <select value={salesRep} onChange={(e) => setSalesRep(e.target.value)} className={SEL}>
                <option value="">Select…</option>
                {formOpts.salesReps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={salesRep} onChange={(e) => setSalesRep(e.target.value)} />
            )}
          </div>
          <div>
            <label className={FL}>Title Officer</label>
            {formOpts?.titleOfficers?.length ? (
              <select value={titleOfficer} onChange={(e) => setTitleOfficer(e.target.value)} className={SEL}>
                <option value="">Select…</option>
                {formOpts.titleOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={titleOfficer} onChange={(e) => setTitleOfficer(e.target.value)} />
            )}
          </div>
        </div>
        {txType === 'Purchase' && (
          <div className="mb-3">
            <label className={FL}>Sales Amount</label>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={salesAmount} onChange={(e) => setSalesAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div>
          </div>
        )}
        {txType === 'Refinance' && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className={FL}>Loan Number</label><input className={IN} value={loanNumber} onChange={(e) => setLoanNumber(e.target.value)} /></div>
            <div><label className={FL}>Loan Amount</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={loanAmount} onChange={(e) => setLoanAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div></div>
          </div>
        )}
        <div className="mb-3"><label className={FL}>Coverage Amount</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span><input className={`${IN} pl-7`} value={coverageAmount} onChange={(e) => setCoverageAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" /></div></div>
        {(txType === 'Purchase' || txType === 'Refinance') && (
          <div className="border-t border-gray-100 pt-3">
            <PersonFields person={borrower} onChange={setBorrower} label="Primary Borrower" />
            {txType === 'Purchase' && !hasSecBorrower && (
              <button onClick={() => setHasSecBorrower(true)} className="text-xs font-medium text-[#1A1A2E] flex items-center gap-1 min-h-[36px]">+ Add secondary borrower</button>
            )}
            {txType === 'Purchase' && hasSecBorrower && (
              <>
                <div className="flex items-center justify-between"><span className="text-xs text-[#6B7280]">Secondary Borrower</span><button onClick={() => { setHasSecBorrower(false); setSecBorrower({ ...EP }); }} className="text-xs text-red-500 min-h-[36px]">Remove</button></div>
                <PersonFields person={secBorrower} onChange={setSecBorrower} label="" />
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-[#6B7280] mt-2">
              <input type="checkbox" checked={borrowerIsOrg} onChange={(e) => setBorrowerIsOrg(e.target.checked)} className="rounded border-gray-300 text-[#C5A55A] h-4 w-4" /> Borrower is an organization
            </label>
            {borrowerIsOrg && (
              <select value={borrowerOrgType} onChange={(e) => setBorrowerOrgType(e.target.value)} className="mt-2 h-9 px-2 border border-gray-200 rounded-lg text-xs">
                <option value="">Type…</option>
                {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Parties */}
      <div className={SECTION}>
        <p className={SH}>
          <svg className="h-5 w-5 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          Parties
        </p>
        <ContactFields contact={buyerAgent} onChange={setBuyerAgent} label="Buyer's Agent" searchRole="buyer_agent" />
        <ContactFields contact={listingAgent} onChange={setListingAgent} label="Listing Agent" searchRole="listing_agent" />
        <ContactFields contact={lender} onChange={setLender} label="Lender" searchRole="lender" companyFirst />
        <ContactFields contact={escrow} onChange={setEscrow} label="Escrow Company" searchRole="escrow_officer" companyFirst />
        <div className="mb-4">
          <label className={FL}>Escrow Officer</label>
          {formOpts?.escrowOfficers?.length ? (
            <select value={escrowOfficer} onChange={(e) => setEscrowOfficer(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {formOpts.escrowOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={IN} value={escrowOfficer} onChange={(e) => setEscrowOfficer(e.target.value)} placeholder="Escrow officer name" />
          )}
        </div>
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Deliverable Emails</p>
            {deliverableEmails.length < 5 && (
              <button onClick={() => setDeliverableEmails([...deliverableEmails, ''])} className="text-xs font-medium text-[#C5A55A] hover:text-[#B8953D] min-h-[36px]">+ Add</button>
            )}
          </div>
          {deliverableEmails.map((em, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className={IN} type="email" value={em} onChange={(e) => { const arr = [...deliverableEmails]; arr[i] = e.target.value; setDeliverableEmails(arr); }} placeholder="email@example.com" />
              <button onClick={() => setDeliverableEmails(deliverableEmails.filter((_, j) => j !== i))} className="text-red-500 px-2 min-h-[36px]">×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed Submit Bar */}
      <div className="fixed bottom-0 left-64 right-0 bg-white border-t border-gray-200 px-8 py-4 flex items-center justify-between z-30">
        <div>
          {result?.type === 'error' && <p className="text-sm text-red-600">{result.message}</p>}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-8 py-3 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#B8953D] disabled:opacity-50 transition-colors h-11 inline-flex items-center gap-2"
        >
          {submitting ? 'Creating Order…' : 'Create Order'}
        </button>
      </div>

      <PropertyConfirmModal
        open={showConfirmModal}
        address={pendingAddress ?? { street: '', city: '', state: '', zip: '' }}
        onConfirm={handleConfirm}
        onNoMatch={() => { setShowConfirmModal(false); setNoMatchMsg('Property not found — enter details manually.'); }}
        onReject={() => { setShowConfirmModal(false); setStreet(''); setCity(''); setState(''); setZip(''); }}
        accentColor="#C5A55A"
      />
    </div>
  );
}
