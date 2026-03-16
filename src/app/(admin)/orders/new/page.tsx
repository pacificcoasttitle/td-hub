'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type {
  WizardStep, OrderTypeData, PropertyData, PartiesData,
  TransactionData, ContactsData, SubmitResult,
} from '@/components/admin/new-order';
import { EMPTY_PERSON, STEPS } from '@/components/admin/new-order';
import { Step1OrderType } from '@/components/admin/new-order/step-order-type';
import { Step2Property } from '@/components/admin/new-order/step-property';
import { Step3Parties } from '@/components/admin/new-order/step-parties';
import { Step4Transaction } from '@/components/admin/new-order/step-transaction';
import { Step5Contacts } from '@/components/admin/new-order/step-contacts';
import { Step6Review } from '@/components/admin/new-order/step-review';
import { ClientSelector, type ClientContact } from '@/components/admin/client-selector';

interface SessionInfo {
  role: string;
  displayName: string;
}

const SELECTOR_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export default function NewOrderPage() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<WizardStep>(1);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientContact | null>(null);
  const [clientLoading, setClientLoading] = useState(false);

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
  const [result, setResult] = useState<SubmitResult | null>(null);

  const showSelector = session && SELECTOR_ROLES.includes(session.role);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setSession({ role: d.role, displayName: d.displayName ?? d.email }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const clientId = searchParams.get('clientId');
    if (clientId && session && SELECTOR_ROLES.includes(session.role)) {
      setClientLoading(true);
      fetch(`/api/contacts/${clientId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((c) => { if (c) handleClientSelect(c); })
        .catch(() => {})
        .finally(() => setClientLoading(false));
    }
  }, [searchParams, session]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClientSelect(client: ClientContact) {
    setSelectedClient(client);
    if (client.fullName) {
      const parts = client.fullName.split(' ');
      const firstName = parts[0] ?? '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      const middleName = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
      setParties((prev) => ({
        ...prev,
        buyer: { firstName, middleName, lastName },
      }));
    }
    if (client.companyName) {
      setParties((prev) => ({
        ...prev,
        buyerIsOrg: true,
        orgType: prev.orgType || '',
      }));
    }
  }

  function handleClientClear() {
    setSelectedClient(null);
    setParties((prev) => ({
      ...prev,
      buyer: { ...EMPTY_PERSON },
      buyerIsOrg: false,
      orgType: '',
    }));
  }

  function goTo(s: WizardStep) { setStep(s); }
  function next() { if (step < 6) setStep((step + 1) as WizardStep); }
  function prev() { if (step > 1) setStep((step - 1) as WizardStep); }
  function resetWizard() {
    setStep(1);
    setOrderType({ orderType: 'title_escrow', rushOrder: false, branchId: null });
    setProperty({ street: '', city: '', state: '', zip: '', placeId: '', apn: '', county: '', legalDescription: '', siteXLoading: false });
    setParties({ seller: { ...EMPTY_PERSON }, secondarySeller: { ...EMPTY_PERSON }, hasSecondarySeller: false, buyer: { ...EMPTY_PERSON }, secondaryBuyer: { ...EMPTY_PERSON }, hasSecondaryBuyer: false, buyerIsOrg: false, orgType: '' });
    setTransaction({ transactionType: '', productType: '', escrowNumber: '', salesAmount: '', loanNumber: '', loanAmount: '', coverageAmount: '', underwriter: '' });
    setContacts({ escrowCompany: null, lender: null, buyerAgent: null, listingAgent: null, titleOfficer: null });
    setSelectedClient(null);
    setSubmitting(false);
    setResult(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType, property, parties, transaction, contacts,
          clientId: selectedClient?.id ?? null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Order creation failed (${res.status})`);
      setResult({
        type: 'success',
        message: `Order ${body.fileNumber} created successfully.`,
        fileNumber: body.fileNumber,
        orderId: body.id,
        titlePointTriggered: body.titlePointTriggered ?? false,
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

      {/* Client Selector (for admin/open_order_team roles) */}
      {showSelector && (
        <div className="max-w-3xl mb-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="h-4 w-4 text-[#1B2A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Client</p>
            </div>
            {clientLoading ? (
              <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : (
              <ClientSelector
                selected={selectedClient}
                onSelect={handleClientSelect}
                onClear={handleClientClear}
              />
            )}
          </div>
        </div>
      )}

      {/* "Opening on behalf of" banner */}
      {showSelector && selectedClient && (
        <div className="max-w-3xl mb-6">
          <div className="bg-[#C5A55A]/10 border border-[#C5A55A]/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
            <svg className="h-4 w-4 text-[#8B7340] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[#8B7340]">
              Opening on behalf of: <span className="font-semibold">{selectedClient.fullName ?? selectedClient.companyName}</span>
              {selectedClient.email && <span className="text-[#8B7340]/60"> ({selectedClient.email})</span>}
            </p>
          </div>
        </div>
      )}

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
              onSubmit={handleSubmit} onPrev={prev} onGoTo={goTo} onReset={resetWizard}
            />
          )}
        </div>
      </div>
    </div>
  );
}
