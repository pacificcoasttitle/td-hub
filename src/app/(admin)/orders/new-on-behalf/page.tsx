'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  WizardStep, OrderTypeData, PropertyData, PartiesData,
  TransactionData, ContactsData, SubmitResult, ContactResult,
} from '@/components/admin/new-order';
import { EMPTY_PERSON, STEPS } from '@/components/admin/new-order';
import { Step1OrderType } from '@/components/admin/new-order/step-order-type';
import { Step2Property } from '@/components/admin/new-order/step-property';
import { Step3Parties } from '@/components/admin/new-order/step-parties';
import { Step4Transaction } from '@/components/admin/new-order/step-transaction';
import { Step5Contacts } from '@/components/admin/new-order/step-contacts';
import { Step6Review } from '@/components/admin/new-order/step-review';

interface ClientContact {
  id: number;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

export default function NewOrderOnBehalfPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);

  // Client selection
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<ClientContact[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientContact | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Wizard state (same as admin)
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

  // Client search
  const searchClients = useCallback(async (q: string) => {
    setClientSearch(q);
    if (q.trim().length < 2) { setClientResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setClientResults(data.results ?? []);
    } catch { setClientResults([]); }
    finally { setSearchLoading(false); }
  }, []);

  function selectClient(client: ClientContact) {
    setSelectedClient(client);
    setClientResults([]);
    setClientSearch(client.fullName ?? client.email ?? '');

    // Auto-fill escrow company contact from the selected client
    const autoContact: ContactResult = {
      id: client.id,
      fullName: client.fullName,
      companyName: client.companyName,
      email: client.email,
      phone: client.phone,
    };
    setContacts((prev) => ({ ...prev, escrowCompany: autoContact }));
  }

  function clearClient() {
    setSelectedClient(null);
    setClientSearch('');
    setContacts((prev) => ({ ...prev, escrowCompany: null }));
  }

  function goTo(s: WizardStep) { setStep(s); }
  function next() { if (step < 6) setStep((step + 1) as WizardStep); }
  function prev() { if (step > 1) setStep((step - 1) as WizardStep); }
  function resetWizard() {
    setStep(1);
    setSelectedClient(null);
    setClientSearch('');
    setOrderType({ orderType: 'title_escrow', rushOrder: false, branchId: null });
    setProperty({ street: '', city: '', state: '', zip: '', placeId: '', apn: '', county: '', legalDescription: '', siteXLoading: false });
    setParties({ seller: { ...EMPTY_PERSON }, secondarySeller: { ...EMPTY_PERSON }, hasSecondarySeller: false, buyer: { ...EMPTY_PERSON }, secondaryBuyer: { ...EMPTY_PERSON }, hasSecondaryBuyer: false, buyerIsOrg: false, orgType: '' });
    setTransaction({ transactionType: '', productType: '', escrowNumber: '', salesAmount: '', loanNumber: '', loanAmount: '', coverageAmount: '', underwriter: '' });
    setContacts({ escrowCompany: null, lender: null, buyerAgent: null, listingAgent: null, titleOfficer: null });
    setSubmitting(false);
    setResult(null);
  }

  async function handleSubmit() {
    if (!selectedClient) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType, property, parties, transaction, contacts,
          onBehalfOfContactId: selectedClient.id,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Order creation failed (${res.status})`);
      setResult({
        type: 'success',
        message: `Order ${body.fileNumber} created on behalf of ${selectedClient.fullName ?? 'client'}.`,
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
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Open Order on Behalf of Client</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">Search for a client, then fill in the order details</p>
        </div>
      </div>

      {/* Client Selector */}
      <div className="max-w-3xl mb-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <label className="block text-sm font-medium text-[#1A1A2E] mb-2">
            Select Client
          </label>

          {selectedClient ? (
            <div className="flex items-center justify-between bg-[#C5A55A]/10 border border-[#C5A55A]/30 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1A1A2E]">
                  Opening order on behalf of: {selectedClient.fullName ?? 'Unknown'}
                </p>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  {[selectedClient.email, selectedClient.companyName].filter(Boolean).join(' — ')}
                </p>
              </div>
              <button
                onClick={clearClient}
                className="text-xs text-[#6B7280] hover:text-red-600 transition-colors px-2 py-1"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => searchClients(e.target.value)}
                placeholder="Search by name, email, or company..."
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/50 focus:border-[#C5A55A]"
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">
                  Searching...
                </div>
              )}
              {clientResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {clientResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectClient(c)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                    >
                      <p className="text-sm font-medium text-[#1A1A2E]">{c.fullName ?? 'No name'}</p>
                      <p className="text-xs text-[#6B7280]">
                        {[c.email, c.companyName, c.phone].filter(Boolean).join(' — ')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Only show wizard after client is selected */}
      {selectedClient && (
        <>
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
        </>
      )}
    </div>
  );
}
