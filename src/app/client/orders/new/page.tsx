'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6;
interface Person { firstName: string; middleName: string; lastName: string; }
interface Contact { id: number; fullName: string | null; companyName: string | null; email: string | null; phone: string | null; }
interface Profile { displayName: string; email: string; phone: string | null; company: string | null; }

const EMPTY: Person = { firstName: '', middleName: '', lastName: '' };
const STEPS = [
  { n: 1 as Step, label: 'Type' },
  { n: 2 as Step, label: 'Property' },
  { n: 3 as Step, label: 'Parties' },
  { n: 4 as Step, label: 'Transaction' },
  { n: 5 as Step, label: 'Contacts' },
  { n: 6 as Step, label: 'Review' },
];
const ORDER_TYPES = [
  { value: 'title_only', label: 'Title Only', sub: 'Title search & insurance' },
  { value: 'title_escrow', label: 'Title & Escrow', sub: 'Full title and escrow' },
  { value: 'escrow_only', label: 'Escrow Only', sub: 'Escrow services only' },
] as const;
const UNDERWRITERS = [
  { value: '', label: 'Select…' }, { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' }, { value: 'natic', label: 'NATIC' }, { value: 'doma', label: 'Doma' },
];
const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];

const IN = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]/40 bg-white min-h-[44px]';
const SEL = IN;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ClientNewOrderPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [orderType, setOrderType] = useState<{ type: string; rush: boolean }>({ type: 'title_escrow', rush: false });
  const [property, setProperty] = useState({ street: '', city: '', state: '', zip: '', placeId: '', apn: '', county: '', legalDescription: '', siteXLoading: false });
  const [parties, setParties] = useState({
    seller: { ...EMPTY }, secondarySeller: { ...EMPTY }, hasSecondary: false,
    buyer: { ...EMPTY }, secondaryBuyer: { ...EMPTY }, hasSecondaryBuyer: false,
    buyerIsOrg: false, orgType: '',
  });
  const [transaction, setTransaction] = useState({ transactionType: '' as string, productType: '', escrowNumber: '', salesAmount: '', loanNumber: '', loanAmount: '', coverageAmount: '', underwriter: '' });
  const [contacts, setContacts] = useState<{ escrowCompany: Contact | null; lender: Contact | null; buyerAgent: Contact | null; listingAgent: Contact | null; titleOfficer: Contact | null }>({
    escrowCompany: null, lender: null, buyerAgent: null, listingAgent: null, titleOfficer: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; orderId?: number } | null>(null);

  useEffect(() => {
    fetch('/api/client/profile').then((r) => r.ok ? r.json() : null).then((d) => setProfile(d)).catch(() => {});
  }, []);

  function next() { if (step < 6) setStep((step + 1) as Step); }
  function prev() { if (step > 1) setStep((step - 1) as Step); }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/client/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderType, property, parties, transaction, contacts }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Order creation failed (${res.status})`);
      setResult({ type: 'success', message: `Order ${body.fileNumber} created.`, orderId: body.id });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.type === 'success' && result.orderId) {
    return (
      <div className="px-1 sm:px-0 max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-[#1B2A4A] px-6 py-5 flex items-center gap-3">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-white font-semibold">Order Submitted</p>
              <p className="text-white/60 text-sm">Your order is now being processed</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-[#1A1A2E]">{result.message}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href={`/client/orders/${result.orderId}`} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors min-h-[44px]">
                View Order Timeline
              </Link>
              <Link href="/client/dashboard" className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-1 sm:px-0">
      <Link href="/client/dashboard" className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-4 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E] mb-1">Open New Order</h1>
      <p className="text-sm text-[#6B7280] mb-6">Create a title or escrow order</p>

      {/* Profile card */}
      {profile && (
        <div className="bg-[#1B2A4A]/5 border border-[#1B2A4A]/10 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
          <div className="h-8 w-8 bg-[#1B2A4A] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{profile.displayName?.charAt(0)?.toUpperCase() ?? 'U'}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1A1A2E]">Opening as: {profile.displayName}</p>
            <p className="text-xs text-[#6B7280] truncate">{profile.email}{profile.company ? ` · ${profile.company}` : ''}</p>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => { if (s.n < step) setStep(s.n); }}
              disabled={s.n > step}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[36px] ${
                s.n === step ? 'bg-[#1B2A4A] text-white' : s.n < step ? 'bg-[#1B2A4A]/10 text-[#1B2A4A]' : 'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.n < step ? 'bg-[#1B2A4A] text-white' : s.n === step ? 'bg-white/20' : ''}`}>
                {s.n < step ? '✓' : s.n}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <div className="w-3 h-px bg-gray-200 flex-shrink-0" />}
          </div>
        ))}
      </div>

      <div className="max-w-2xl">
        <div className="bg-white rounded-lg border border-gray-200">
          {step === 1 && <StepType data={orderType} onChange={setOrderType} onNext={next} />}
          {step === 2 && <StepProperty data={property} onChange={setProperty} onNext={next} onPrev={prev} />}
          {step === 3 && <StepParties data={parties} onChange={setParties} onNext={next} onPrev={prev} />}
          {step === 4 && <StepTransaction data={transaction} onChange={setTransaction} onNext={next} onPrev={prev} />}
          {step === 5 && <StepContacts data={contacts} onChange={setContacts} onNext={next} onPrev={prev} />}
          {step === 6 && (
            <StepReview
              orderType={orderType} property={property} parties={parties}
              transaction={transaction} contacts={contacts}
              submitting={submitting} error={result?.type === 'error' ? result.message : null}
              onSubmit={handleSubmit} onPrev={prev} onGoTo={setStep}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step Components ────────────────────────────────────────────────────────

function StepType({ data, onChange, onNext }: { data: { type: string; rush: boolean }; onChange: (d: { type: string; rush: boolean }) => void; onNext: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Order Type" sub="What services do you need?" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {ORDER_TYPES.map((ot) => (
          <button key={ot.value} onClick={() => onChange({ ...data, type: ot.value })}
            className={`text-left px-4 py-4 rounded-lg border-2 transition-colors min-h-[70px] ${data.type === ot.value ? 'border-[#1B2A4A] bg-[#1B2A4A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/30'}`}>
            <p className="font-semibold text-[#1A1A2E] text-sm">{ot.label}</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{ot.sub}</p>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 cursor-pointer py-2 min-h-[44px]">
        <input type="checkbox" checked={data.rush} onChange={(e) => onChange({ ...data, rush: e.target.checked })} className="rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]/40 h-5 w-5" />
        <div>
          <p className="text-sm font-medium text-[#1A1A2E]">Rush Order</p>
          <p className="text-xs text-[#6B7280]">Expedited processing</p>
        </div>
      </label>
      <Nav onNext={onNext} nextDisabled={!data.type} />
    </div>
  );
}

function StepProperty({ data, onChange, onNext, onPrev }: { data: typeof import('./page').default extends never ? never : any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  function handleSelect(parsed: ParsedAddress) {
    const updated = { ...data, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip, placeId: parsed.placeId, siteXLoading: true };
    onChange(updated);
    fetch('/api/orders/sitex-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => onChange({ ...updated, apn: res?.apn ?? updated.apn, county: res?.county ?? updated.county, legalDescription: res?.legalDescription ?? updated.legalDescription, siteXLoading: false }))
      .catch(() => onChange({ ...updated, siteXLoading: false }));
  }
  return (
    <div className="p-5 sm:p-6">
      <SH title="Property" sub="Enter the property address." />
      <div className="space-y-4">
        <div><FL>Address</FL><AddressAutocomplete value={data.street} onChange={(v: string) => onChange({ ...data, street: v })} onSelect={handleSelect} placeholder="Start typing…" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><FL>City</FL><input className={IN} value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} /></div>
          <div><FL>State</FL><input className={IN} value={data.state} onChange={(e) => onChange({ ...data, state: e.target.value })} /></div>
          <div><FL>ZIP</FL><input className={IN} value={data.zip} onChange={(e) => onChange({ ...data, zip: e.target.value })} /></div>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Details</p>
            {data.siteXLoading && <span className="text-xs text-[#1B2A4A] animate-pulse">Looking up…</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><FL>County</FL><input className={IN} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="Auto-filled" /></div>
            <div><FL>APN</FL><input className={IN} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="Auto-filled" /></div>
          </div>
          <div className="mt-3"><FL>Legal Description</FL><textarea value={data.legalDescription} onChange={(e) => onChange({ ...data, legalDescription: e.target.value })} rows={2} className={`${IN} resize-none`} placeholder="Auto-filled" /></div>
        </div>
      </div>
      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.street} />
    </div>
  );
}

function StepParties({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
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

function StepTransaction({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Transaction" sub="Financial and transaction details." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div><FL>Transaction Type</FL><select value={data.transactionType} onChange={(e) => onChange({ ...data, transactionType: e.target.value })} className={SEL}><option value="">Select…</option><option value="Purchase">Purchase</option><option value="Refinance">Refinance</option><option value="Equity">Equity</option><option value="Other">Other</option></select></div>
        <div><FL>Product Type</FL><input className={IN} value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} placeholder="Standard, Commercial…" /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div><FL>Escrow Number</FL><input className={IN} value={data.escrowNumber} onChange={(e) => onChange({ ...data, escrowNumber: e.target.value })} placeholder="Optional" /></div>
        <div><FL>Underwriter</FL><select value={data.underwriter} onChange={(e) => onChange({ ...data, underwriter: e.target.value })} className={SEL}>{UNDERWRITERS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></div>
      </div>
      {data.transactionType === 'Purchase' && <div className="mb-4"><FL>Sales Amount</FL><CurrInput value={data.salesAmount} onChange={(v) => onChange({ ...data, salesAmount: v })} /></div>}
      {data.transactionType === 'Refinance' && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div><FL>Loan Number</FL><input className={IN} value={data.loanNumber} onChange={(e) => onChange({ ...data, loanNumber: e.target.value })} /></div>
          <div><FL>Loan Amount</FL><CurrInput value={data.loanAmount} onChange={(v) => onChange({ ...data, loanAmount: v })} /></div>
        </div>
      )}
      <div><FL>Coverage Amount</FL><CurrInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} /></div>
      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.transactionType} />
    </div>
  );
}

function StepContacts({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Contacts" sub="Assign contacts to this order." />
      <div className="space-y-5">
        <CSF label="Escrow Company" selected={data.escrowCompany} onSelect={(c) => onChange({ ...data, escrowCompany: c })} onClear={() => onChange({ ...data, escrowCompany: null })} url="/api/contacts?role=escrow_officer" />
        <CSF label="Lender" selected={data.lender} onSelect={(c) => onChange({ ...data, lender: c })} onClear={() => onChange({ ...data, lender: null })} url="/api/contacts?role=lender" />
        <CSF label="Buyer's Agent" selected={data.buyerAgent} onSelect={(c) => onChange({ ...data, buyerAgent: c })} onClear={() => onChange({ ...data, buyerAgent: null })} url="/api/contacts?role=buyer_agent" />
        <CSF label="Listing Agent" selected={data.listingAgent} onSelect={(c) => onChange({ ...data, listingAgent: c })} onClear={() => onChange({ ...data, listingAgent: null })} url="/api/contacts?role=listing_agent" />
        <CSF label="Title Officer" selected={data.titleOfficer} onSelect={(c) => onChange({ ...data, titleOfficer: c })} onClear={() => onChange({ ...data, titleOfficer: null })} url="/api/contacts?role=title_officer" />
      </div>
      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function StepReview({ orderType, property, parties, transaction, contacts, submitting, error, onSubmit, onPrev, onGoTo }: {
  orderType: any; property: any; parties: any; transaction: any; contacts: any;
  submitting: boolean; error: string | null; onSubmit: () => void; onPrev: () => void; onGoTo: (s: Step) => void;
}) {
  const cn = (c: Contact | null) => c?.fullName ?? c?.companyName ?? '—';
  const fp = (p: Person) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '—';
  return (
    <div className="p-5 sm:p-6">
      <SH title="Review & Submit" sub="Confirm order details." />
      <div className="space-y-4 mb-6">
        <RS title="Order Type" onEdit={() => onGoTo(1)}><RF l="Type" v={ORDER_TYPES.find((o) => o.value === orderType.type)?.label ?? orderType.type} /><RF l="Rush" v={orderType.rush ? 'Yes' : 'No'} /></RS>
        <RS title="Property" onEdit={() => onGoTo(2)}><RF l="Address" v={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} /><RF l="County" v={property.county || '—'} /></RS>
        <RS title="Parties" onEdit={() => onGoTo(3)}><RF l="Seller" v={fp(parties.seller)} /><RF l="Buyer" v={fp(parties.buyer)} /></RS>
        <RS title="Transaction" onEdit={() => onGoTo(4)}><RF l="Type" v={transaction.transactionType || '—'} />{transaction.underwriter && <RF l="Underwriter" v={UNDERWRITERS.find((u) => u.value === transaction.underwriter)?.label ?? transaction.underwriter} />}</RS>
        <RS title="Contacts" onEdit={() => onGoTo(5)}><RF l="Escrow" v={cn(contacts.escrowCompany)} /><RF l="Lender" v={cn(contacts.lender)} /><RF l="Title Officer" v={cn(contacts.titleOfficer)} /></RS>
      </div>
      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <button onClick={onPrev} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">← Back</button>
        <button onClick={onSubmit} disabled={submitting} className="px-6 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors inline-flex items-center gap-2 min-h-[44px]">
          {submitting ? 'Creating…' : 'Submit Order'}
        </button>
      </div>
    </div>
  );
}

// ─── Shared Primitives ──────────────────────────────────────────────────────

function SH({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-5"><h3 className="text-lg font-semibold text-[#1A1A2E]">{title}</h3><p className="text-sm text-[#6B7280] mt-0.5">{sub}</p></div>;
}
function FL({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#6B7280] mb-1">{children}</label>;
}
function Nav({ onPrev, onNext, nextDisabled }: { onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
      {onPrev ? <button onClick={onPrev} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">← Back</button> : <div />}
      {onNext && <button onClick={onNext} disabled={nextDisabled} className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors min-h-[44px]">Continue →</button>}
    </div>
  );
}
function PF({ person, onChange }: { person: Person; onChange: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><FL>First Name</FL><input className={IN} value={person.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First" /></div>
      <div><FL>Middle</FL><input className={IN} value={person.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle" /></div>
      <div><FL>Last Name</FL><input className={IN} value={person.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last" /></div>
    </div>
  );
}
function CurrInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">$</span>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" className={`${IN} pl-7`} />
    </div>
  );
}
function RS({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{title}</p><button onClick={onEdit} className="text-xs text-[#1B2A4A] font-medium min-h-[44px]">Edit</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">{children}</div>
    </div>
  );
}
function RF({ l, v }: { l: string; v: string }) {
  return <div className="flex items-baseline gap-2"><span className="text-xs text-[#6B7280] flex-shrink-0">{l}:</span><span className="text-sm text-[#1A1A2E] font-medium truncate">{v}</span></div>;
}

function CSF({ label, selected, onSelect, onClear, url }: {
  label: string; selected: Contact | null; onSelect: (c: Contact) => void; onClear: () => void; url: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const sep = url.includes('?') ? '&' : '?';
    fetch(`${url}${sep}search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => setResults(d.contacts ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [url]);

  function handleInput(v: string) { setQuery(v); setOpen(true); clearTimeout(debRef.current); debRef.current = setTimeout(() => search(v), 250); }

  useEffect(() => {
    function click(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  if (selected) {
    return (
      <div><FL>{label}</FL>
        <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg min-h-[44px]">
          <div><p className="text-sm font-medium text-[#1A1A2E]">{selected.fullName ?? selected.companyName ?? 'Contact'}</p><p className="text-xs text-[#6B7280]">{[selected.email, selected.phone].filter(Boolean).join(' · ')}</p></div>
          <button onClick={onClear} className="text-xs text-red-500 ml-3 min-h-[44px]">Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative"><FL>{label}</FL>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={query} onChange={(e) => handleInput(e.target.value)} onFocus={() => { if (query.length >= 2) setOpen(true); }} placeholder={`Search ${label.toLowerCase()}…`} className={`${IN} pl-10`} />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {searching ? <div className="px-4 py-3 text-sm text-[#6B7280]">Searching…</div>
            : results.length > 0 ? results.map((c) => (
              <button key={c.id} onClick={() => { onSelect(c); setQuery(''); setResults([]); setOpen(false); }} className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 min-h-[44px]">
                <p className="text-sm font-medium text-[#1A1A2E]">{c.fullName ?? c.companyName ?? 'Unknown'}</p>
                <p className="text-xs text-[#6B7280]">{[c.email].filter(Boolean).join(' · ')}</p>
              </button>
            )) : <div className="px-4 py-3 text-sm text-[#6B7280]">No results</div>}
        </div>
      )}
    </div>
  );
}
