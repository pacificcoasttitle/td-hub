'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';

// ─── Types ──────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface Branch {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface ContactResult {
  id: number;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

interface OrderTypeData {
  orderType: 'title_only' | 'title_escrow' | 'escrow_only';
  rushOrder: boolean;
  branchId: number | null;
}

interface PropertyData {
  street: string;
  city: string;
  state: string;
  zip: string;
  placeId: string;
  apn: string;
  county: string;
  legalDescription: string;
  siteXLoading: boolean;
}

interface PartyPerson {
  firstName: string;
  middleName: string;
  lastName: string;
}

interface PartiesData {
  seller: PartyPerson;
  secondarySeller: PartyPerson;
  hasSecondarySeller: boolean;
  buyer: PartyPerson;
  secondaryBuyer: PartyPerson;
  hasSecondaryBuyer: boolean;
  buyerIsOrg: boolean;
  orgType: string;
}

interface TransactionData {
  transactionType: 'Purchase' | 'Refinance' | 'Equity' | 'Other' | '';
  productType: string;
  escrowNumber: string;
  salesAmount: string;
  loanNumber: string;
  loanAmount: string;
  coverageAmount: string;
  underwriter: string;
}

interface ContactsData {
  escrowCompany: ContactResult | null;
  lender: ContactResult | null;
  buyerAgent: ContactResult | null;
  listingAgent: ContactResult | null;
  titleOfficer: ContactResult | null;
}

const EMPTY_PERSON: PartyPerson = { firstName: '', middleName: '', lastName: '' };

const STEPS: { n: WizardStep; label: string }[] = [
  { n: 1, label: 'Order Type' },
  { n: 2, label: 'Property' },
  { n: 3, label: 'Parties' },
  { n: 4, label: 'Transaction' },
  { n: 5, label: 'Contacts' },
  { n: 6, label: 'Review' },
];

const ORDER_TYPES = [
  { value: 'title_only', label: 'Title Only', description: 'Title search and insurance only' },
  { value: 'title_escrow', label: 'Title & Escrow', description: 'Full title and escrow services' },
  { value: 'escrow_only', label: 'Escrow Only', description: 'Escrow services without title' },
] as const;

const UNDERWRITERS = [
  { value: '', label: 'Select underwriter…' },
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' },
  { value: 'natic', label: 'NATIC' },
  { value: 'doma', label: 'Doma' },
];

const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];

const INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] ' +
  'placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 ' +
  'focus:border-[#C5A55A] bg-white';

const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] ' +
  'bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function NewOrderPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);

  const [orderType, setOrderType] = useState<OrderTypeData>({
    orderType: 'title_escrow', rushOrder: false, branchId: null,
  });
  const [property, setProperty] = useState<PropertyData>({
    street: '', city: '', state: '', zip: '', placeId: '',
    apn: '', county: '', legalDescription: '', siteXLoading: false,
  });
  const [parties, setParties] = useState<PartiesData>({
    seller: { ...EMPTY_PERSON }, secondarySeller: { ...EMPTY_PERSON }, hasSecondarySeller: false,
    buyer: { ...EMPTY_PERSON }, secondaryBuyer: { ...EMPTY_PERSON }, hasSecondaryBuyer: false,
    buyerIsOrg: false, orgType: '',
  });
  const [transaction, setTransaction] = useState<TransactionData>({
    transactionType: '', productType: '', escrowNumber: '',
    salesAmount: '', loanNumber: '', loanAmount: '', coverageAmount: '', underwriter: '',
  });
  const [contacts, setContacts] = useState<ContactsData>({
    escrowCompany: null, lender: null, buyerAgent: null, listingAgent: null, titleOfficer: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; fileNumber?: string; orderId?: number } | null>(null);

  function goTo(s: WizardStep) { setStep(s); }
  function next() { if (step < 6) setStep((step + 1) as WizardStep); }
  function prev() { if (step > 1) setStep((step - 1) as WizardStep); }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderType, property, parties, transaction, contacts }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Order creation failed (${res.status})`);
      setResult({
        type: 'success',
        message: `Order ${body.fileNumber} created successfully.`,
        fileNumber: body.fileNumber,
        orderId: body.id,
      });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/orders" className="text-[#6B7280] hover:text-[#1B2A4A] transition-colors">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Open New Order</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">Create a title/escrow order and send to SoftPro</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => { if (s.n < step) goTo(s.n); }}
              disabled={s.n > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                s.n === step
                  ? 'bg-[#1B2A4A] text-white'
                  : s.n < step
                    ? 'bg-[#C5A55A]/20 text-[#1B2A4A] hover:bg-[#C5A55A]/30 cursor-pointer'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                s.n < step ? 'bg-[#C5A55A] text-white' : s.n === step ? 'bg-white/20' : ''
              }`}>
                {s.n < step ? '✓' : s.n}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <div className="w-4 h-px bg-gray-200 flex-shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="max-w-3xl">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          {step === 1 && <Step1OrderType data={orderType} onChange={setOrderType} onNext={next} />}
          {step === 2 && <Step2Property data={property} onChange={setProperty} onNext={next} onPrev={prev} />}
          {step === 3 && <Step3Parties data={parties} onChange={setParties} onNext={next} onPrev={prev} />}
          {step === 4 && <Step4Transaction data={transaction} onChange={setTransaction} onNext={next} onPrev={prev} />}
          {step === 5 && <Step5Contacts data={contacts} onChange={setContacts} onNext={next} onPrev={prev} />}
          {step === 6 && (
            <Step6Review
              orderType={orderType} property={property} parties={parties}
              transaction={transaction} contacts={contacts}
              submitting={submitting} result={result}
              onSubmit={handleSubmit} onPrev={prev} onGoTo={goTo}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Order Type ─────────────────────────────────────────────────────

function Step1OrderType({
  data, onChange, onNext,
}: {
  data: OrderTypeData; onChange: (d: OrderTypeData) => void; onNext: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    fetch('/api/branches')
      .then((r) => r.ok ? r.json() : { branches: [] })
      .then((d) => setBranches(d.branches ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6">
      <StepHeader title="Order Type" sub="What kind of order is this?" />

      <div className="grid grid-cols-3 gap-3 mb-6">
        {ORDER_TYPES.map((ot) => (
          <button
            key={ot.value}
            onClick={() => onChange({ ...data, orderType: ot.value })}
            className={`text-left px-4 py-4 rounded-lg border-2 transition-colors ${
              data.orderType === ot.value
                ? 'border-[#C5A55A] bg-[#C5A55A]/5'
                : 'border-gray-200 hover:border-[#1B2A4A]/30'
            }`}
          >
            <p className="font-semibold text-[#1A1A2E] text-sm">{ot.label}</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{ot.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Branch</FieldLabel>
          <select
            value={data.branchId ?? ''}
            onChange={(e) => onChange({ ...data, branchId: e.target.value ? Number(e.target.value) : null })}
            className={SELECT_CLASS}
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-3 cursor-pointer py-2">
            <div className="relative">
              <input
                type="checkbox"
                checked={data.rushOrder}
                onChange={(e) => onChange({ ...data, rushOrder: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-[#C5A55A] transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">Rush Order</p>
              <p className="text-xs text-[#6B7280]">Expedited processing</p>
            </div>
          </label>
        </div>
      </div>

      <StepNav onNext={onNext} nextDisabled={!data.orderType} />
    </div>
  );
}

// ─── Step 2: Property ───────────────────────────────────────────────────────

function Step2Property({
  data, onChange, onNext, onPrev,
}: {
  data: PropertyData; onChange: (d: PropertyData) => void; onNext: () => void; onPrev: () => void;
}) {
  function handleAddressSelect(parsed: ParsedAddress) {
    const updated = { ...data, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip, placeId: parsed.placeId };
    onChange(updated);
    triggerSiteXLookup(parsed, onChange, updated);
  }

  return (
    <div className="p-6">
      <StepHeader title="Property" sub="Enter the property address — we'll look up details automatically." />

      <div className="space-y-4">
        <div>
          <FieldLabel>Address</FieldLabel>
          <AddressAutocomplete
            value={data.street}
            onChange={(v) => onChange({ ...data, street: v })}
            onSelect={handleAddressSelect}
            placeholder="Start typing an address…"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <FieldLabel>City</FieldLabel>
            <input className={INPUT_CLASS} value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} placeholder="City" />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <input className={INPUT_CLASS} value={data.state} onChange={(e) => onChange({ ...data, state: e.target.value })} placeholder="CA" />
          </div>
          <div>
            <FieldLabel>ZIP</FieldLabel>
            <input className={INPUT_CLASS} value={data.zip} onChange={(e) => onChange({ ...data, zip: e.target.value })} placeholder="ZIP" />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Property Details</p>
            {data.siteXLoading && (
              <span className="inline-flex items-center gap-1 text-xs text-[#C5A55A]">
                <svg className="h-3 w-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Looking up property…
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>County</FieldLabel>
              <input className={INPUT_CLASS} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="Auto-filled from lookup" />
            </div>
            <div>
              <FieldLabel>APN</FieldLabel>
              <input className={INPUT_CLASS} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="Auto-filled from lookup" />
            </div>
          </div>
          <div className="mt-4">
            <FieldLabel>Legal Description</FieldLabel>
            <textarea
              value={data.legalDescription}
              onChange={(e) => onChange({ ...data, legalDescription: e.target.value })}
              placeholder="Auto-filled from lookup"
              rows={3}
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>
        </div>
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} nextDisabled={!data.street} />
    </div>
  );
}

function triggerSiteXLookup(parsed: ParsedAddress, onChange: (d: PropertyData) => void, current: PropertyData) {
  onChange({ ...current, siteXLoading: true });
  fetch('/api/orders/sitex-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  })
    .then((r) => r.ok ? r.json() : null)
    .then((result) => {
      if (result) {
        onChange({
          ...current,
          apn: result.apn ?? current.apn,
          county: result.county ?? current.county,
          legalDescription: result.legalDescription ?? current.legalDescription,
          siteXLoading: false,
        });
      } else {
        onChange({ ...current, siteXLoading: false });
      }
    })
    .catch(() => onChange({ ...current, siteXLoading: false }));
}

// ─── Step 3: Parties ────────────────────────────────────────────────────────

function Step3Parties({
  data, onChange, onNext, onPrev,
}: {
  data: PartiesData; onChange: (d: PartiesData) => void; onNext: () => void; onPrev: () => void;
}) {
  function updateSeller(field: keyof PartyPerson, value: string) {
    onChange({ ...data, seller: { ...data.seller, [field]: value } });
  }
  function updateSecondarySeller(field: keyof PartyPerson, value: string) {
    onChange({ ...data, secondarySeller: { ...data.secondarySeller, [field]: value } });
  }
  function updateBuyer(field: keyof PartyPerson, value: string) {
    onChange({ ...data, buyer: { ...data.buyer, [field]: value } });
  }
  function updateSecondaryBuyer(field: keyof PartyPerson, value: string) {
    onChange({ ...data, secondaryBuyer: { ...data.secondaryBuyer, [field]: value } });
  }

  return (
    <div className="p-6">
      <StepHeader title="Parties" sub="Add the buyer/borrower and seller information." />

      {/* Seller */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Seller</p>
        </div>
        <PersonFields person={data.seller} onChange={updateSeller} prefix="seller" />
        {!data.hasSecondarySeller ? (
          <button
            onClick={() => onChange({ ...data, hasSecondarySeller: true })}
            className="mt-2 text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
          >
            + Add secondary seller
          </button>
        ) : (
          <div className="mt-3 pl-4 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[#6B7280] font-medium">Secondary Seller</p>
              <button
                onClick={() => onChange({ ...data, hasSecondarySeller: false, secondarySeller: { ...EMPTY_PERSON } })}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <PersonFields person={data.secondarySeller} onChange={updateSecondarySeller} prefix="seller2" />
          </div>
        )}
      </div>

      {/* Buyer/Borrower */}
      <div className="border-t border-gray-100 pt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Buyer / Borrower</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={data.buyerIsOrg}
              onChange={(e) => onChange({ ...data, buyerIsOrg: e.target.checked })}
              className="rounded border-gray-300 text-[#C5A55A] focus:ring-[#C5A55A]/40"
            />
            <span className="text-xs text-[#6B7280]">Organization (LLC/Corp)</span>
          </label>
        </div>

        {data.buyerIsOrg && (
          <div className="mb-3">
            <FieldLabel>Organization Type</FieldLabel>
            <select
              value={data.orgType}
              onChange={(e) => onChange({ ...data, orgType: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Select type…</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        <PersonFields person={data.buyer} onChange={updateBuyer} prefix="buyer" />

        {!data.hasSecondaryBuyer ? (
          <button
            onClick={() => onChange({ ...data, hasSecondaryBuyer: true })}
            className="mt-2 text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
          >
            + Add secondary buyer/borrower
          </button>
        ) : (
          <div className="mt-3 pl-4 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[#6B7280] font-medium">Secondary Buyer/Borrower</p>
              <button
                onClick={() => onChange({ ...data, hasSecondaryBuyer: false, secondaryBuyer: { ...EMPTY_PERSON } })}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <PersonFields person={data.secondaryBuyer} onChange={updateSecondaryBuyer} prefix="buyer2" />
          </div>
        )}
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function PersonFields({
  person, onChange, prefix,
}: {
  person: PartyPerson; onChange: (field: keyof PartyPerson, value: string) => void; prefix: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <FieldLabel>First Name</FieldLabel>
        <input className={INPUT_CLASS} value={person.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First" />
      </div>
      <div>
        <FieldLabel>Middle</FieldLabel>
        <input className={INPUT_CLASS} value={person.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle" />
      </div>
      <div>
        <FieldLabel>Last Name</FieldLabel>
        <input className={INPUT_CLASS} value={person.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last" />
      </div>
    </div>
  );
}

// ─── Step 4: Transaction ────────────────────────────────────────────────────

function Step4Transaction({
  data, onChange, onNext, onPrev,
}: {
  data: TransactionData; onChange: (d: TransactionData) => void; onNext: () => void; onPrev: () => void;
}) {
  const isPurchase = data.transactionType === 'Purchase';
  const isRefi = data.transactionType === 'Refinance';

  return (
    <div className="p-6">
      <StepHeader title="Transaction" sub="Transaction details and financial information." />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Transaction Type</FieldLabel>
          <select
            value={data.transactionType}
            onChange={(e) => onChange({ ...data, transactionType: e.target.value as TransactionData['transactionType'] })}
            className={SELECT_CLASS}
          >
            <option value="">Select type…</option>
            <option value="Purchase">Purchase</option>
            <option value="Refinance">Refinance</option>
            <option value="Equity">Equity</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <FieldLabel>Product Type</FieldLabel>
          <input className={INPUT_CLASS} value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} placeholder="e.g. Standard, Commercial" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Escrow Number</FieldLabel>
          <input className={INPUT_CLASS} value={data.escrowNumber} onChange={(e) => onChange({ ...data, escrowNumber: e.target.value })} placeholder="Optional" />
        </div>
        <div>
          <FieldLabel>Underwriter</FieldLabel>
          <select value={data.underwriter} onChange={(e) => onChange({ ...data, underwriter: e.target.value })} className={SELECT_CLASS}>
            {UNDERWRITERS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      {isPurchase && (
        <div className="mb-6">
          <FieldLabel>Sales Amount</FieldLabel>
          <CurrencyInput value={data.salesAmount} onChange={(v) => onChange({ ...data, salesAmount: v })} />
        </div>
      )}

      {isRefi && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <FieldLabel>Loan Number</FieldLabel>
            <input className={INPUT_CLASS} value={data.loanNumber} onChange={(e) => onChange({ ...data, loanNumber: e.target.value })} placeholder="Loan #" />
          </div>
          <div>
            <FieldLabel>Loan Amount</FieldLabel>
            <CurrencyInput value={data.loanAmount} onChange={(v) => onChange({ ...data, loanAmount: v })} />
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Coverage Amount</FieldLabel>
        <CurrencyInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} />
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} nextDisabled={!data.transactionType} />
    </div>
  );
}

function CurrencyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.,]/g, '');
          onChange(v);
        }}
        placeholder="0.00"
        className={`${INPUT_CLASS} pl-7`}
      />
    </div>
  );
}

// ─── Step 5: Contacts ───────────────────────────────────────────────────────

function Step5Contacts({
  data, onChange, onNext, onPrev,
}: {
  data: ContactsData; onChange: (d: ContactsData) => void; onNext: () => void; onPrev: () => void;
}) {
  return (
    <div className="p-6">
      <StepHeader title="Contacts" sub="Assign contacts to this order. Search by name." />

      <div className="space-y-5">
        <ContactSearchField
          label="Escrow Company"
          selected={data.escrowCompany}
          onSelect={(c) => onChange({ ...data, escrowCompany: c })}
          onClear={() => onChange({ ...data, escrowCompany: null })}
          searchUrl="/api/contacts?role=escrow_officer"
        />
        <ContactSearchField
          label="Lender"
          selected={data.lender}
          onSelect={(c) => onChange({ ...data, lender: c })}
          onClear={() => onChange({ ...data, lender: null })}
          searchUrl="/api/contacts?role=lender"
        />
        <ContactSearchField
          label="Buyer's Agent"
          selected={data.buyerAgent}
          onSelect={(c) => onChange({ ...data, buyerAgent: c })}
          onClear={() => onChange({ ...data, buyerAgent: null })}
          searchUrl="/api/contacts?role=buyer_agent"
        />
        <ContactSearchField
          label="Listing Agent"
          selected={data.listingAgent}
          onSelect={(c) => onChange({ ...data, listingAgent: c })}
          onClear={() => onChange({ ...data, listingAgent: null })}
          searchUrl="/api/contacts?role=listing_agent"
        />
        <ContactSearchField
          label="Title Officer"
          selected={data.titleOfficer}
          onSelect={(c) => onChange({ ...data, titleOfficer: c })}
          onClear={() => onChange({ ...data, titleOfficer: null })}
          searchUrl="/api/contacts?role=title_officer"
        />
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function ContactSearchField({
  label, selected, onSelect, onClear, searchUrl,
}: {
  label: string; selected: ContactResult | null;
  onSelect: (c: ContactResult) => void; onClear: () => void; searchUrl: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const sep = searchUrl.includes('?') ? '&' : '?';
    fetch(`${searchUrl}${sep}search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => setResults(d.contacts ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [searchUrl]);

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }

  function handleSelect(c: ContactResult) {
    onSelect(c);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (selected) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
          <div>
            <p className="text-sm font-medium text-[#1A1A2E]">{selected.fullName ?? selected.companyName ?? 'Contact'}</p>
            <p className="text-xs text-[#6B7280]">
              {[selected.companyName && selected.fullName ? selected.companyName : null, selected.email, selected.phone].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 font-medium ml-3 flex-shrink-0">
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder={`Search ${label.toLowerCase()}…`}
          className={`${INPUT_CLASS} pl-10`}
        />
      </div>
      {open && (query.length >= 2) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {searching ? (
            <div className="px-4 py-3 text-sm text-[#6B7280]">Searching…</div>
          ) : results.length > 0 ? (
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
              >
                <p className="text-sm font-medium text-[#1A1A2E]">{c.fullName ?? c.companyName ?? 'Unknown'}</p>
                <p className="text-xs text-[#6B7280]">
                  {[c.companyName && c.fullName ? c.companyName : null, c.email].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-[#6B7280]">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 6: Review & Submit ────────────────────────────────────────────────

function Step6Review({
  orderType, property, parties, transaction, contacts,
  submitting, result, onSubmit, onPrev, onGoTo,
}: {
  orderType: OrderTypeData; property: PropertyData; parties: PartiesData;
  transaction: TransactionData; contacts: ContactsData;
  submitting: boolean; result: { type: 'success' | 'error'; message: string; fileNumber?: string; orderId?: number } | null;
  onSubmit: () => void; onPrev: () => void; onGoTo: (s: WizardStep) => void;
}) {
  const otLabel = ORDER_TYPES.find((o) => o.value === orderType.orderType)?.label ?? orderType.orderType;

  function formatPerson(p: PartyPerson): string {
    return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '—';
  }

  function contactName(c: ContactResult | null): string {
    return c?.fullName ?? c?.companyName ?? '—';
  }

  return (
    <div className="p-6">
      <StepHeader title="Review & Submit" sub="Verify the order details before creating." />

      <div className="space-y-5 mb-6">
        {/* Order Type */}
        <ReviewSection title="Order Type" onEdit={() => onGoTo(1)}>
          <ReviewField label="Type" value={otLabel} />
          <ReviewField label="Rush" value={orderType.rushOrder ? 'Yes' : 'No'} />
          <ReviewField label="Branch" value={orderType.branchId ? `Branch #${orderType.branchId}` : 'Not selected'} />
        </ReviewSection>

        {/* Property */}
        <ReviewSection title="Property" onEdit={() => onGoTo(2)}>
          <ReviewField label="Address" value={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} />
          <ReviewField label="County" value={property.county || '—'} />
          <ReviewField label="APN" value={property.apn || '—'} />
        </ReviewSection>

        {/* Parties */}
        <ReviewSection title="Parties" onEdit={() => onGoTo(3)}>
          <ReviewField label="Seller" value={formatPerson(parties.seller)} />
          {parties.hasSecondarySeller && <ReviewField label="Secondary Seller" value={formatPerson(parties.secondarySeller)} />}
          <ReviewField label="Buyer/Borrower" value={formatPerson(parties.buyer)} />
          {parties.hasSecondaryBuyer && <ReviewField label="Secondary Buyer" value={formatPerson(parties.secondaryBuyer)} />}
          {parties.buyerIsOrg && <ReviewField label="Organization" value={parties.orgType || '—'} />}
        </ReviewSection>

        {/* Transaction */}
        <ReviewSection title="Transaction" onEdit={() => onGoTo(4)}>
          <ReviewField label="Type" value={transaction.transactionType || '—'} />
          {transaction.productType && <ReviewField label="Product" value={transaction.productType} />}
          {transaction.underwriter && <ReviewField label="Underwriter" value={UNDERWRITERS.find((u) => u.value === transaction.underwriter)?.label ?? transaction.underwriter} />}
          {transaction.salesAmount && <ReviewField label="Sales Amount" value={`$${transaction.salesAmount}`} />}
          {transaction.loanAmount && <ReviewField label="Loan Amount" value={`$${transaction.loanAmount}`} />}
          {transaction.coverageAmount && <ReviewField label="Coverage" value={`$${transaction.coverageAmount}`} />}
        </ReviewSection>

        {/* Contacts */}
        <ReviewSection title="Contacts" onEdit={() => onGoTo(5)}>
          <ReviewField label="Escrow Company" value={contactName(contacts.escrowCompany)} />
          <ReviewField label="Lender" value={contactName(contacts.lender)} />
          <ReviewField label="Buyer's Agent" value={contactName(contacts.buyerAgent)} />
          <ReviewField label="Listing Agent" value={contactName(contacts.listingAgent)} />
          <ReviewField label="Title Officer" value={contactName(contacts.titleOfficer)} />
        </ReviewSection>
      </div>

      {result && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          result.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <p className="font-medium">{result.message}</p>
          {result.type === 'success' && result.orderId && (
            <Link href={`/orders/${result.orderId}`} className="text-green-800 underline text-xs mt-1 inline-block">
              View order →
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <button onClick={onPrev} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        {(!result || result.type === 'error') && (
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {submitting && (
              <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {submitting ? 'Creating order in SoftPro…' : 'Create Order'}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewSection({
  title, onEdit, children,
}: {
  title: string; onEdit: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{title}</p>
        <button onClick={onEdit} className="text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors">
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">{children}</div>
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[#6B7280] flex-shrink-0">{label}:</span>
      <span className="text-sm text-[#1A1A2E] font-medium truncate">{value}</span>
    </div>
  );
}

// ─── Shared UI Primitives ───────────────────────────────────────────────────

function StepHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-semibold text-[#1A1A2E]">{title}</h3>
      <p className="text-sm text-[#6B7280] mt-0.5">{sub}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#6B7280] mb-1">{children}</label>;
}

function StepNav({
  onPrev, onNext, nextDisabled, nextLabel,
}: {
  onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean; nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
      {onPrev ? (
        <button onClick={onPrev} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          ← Back
        </button>
      ) : <div />}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="px-5 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {nextLabel ?? 'Continue →'}
        </button>
      )}
    </div>
  );
}
