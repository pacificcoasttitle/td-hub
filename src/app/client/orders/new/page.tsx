'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Step, Contact, Profile } from '@/components/client/new-order';
import { EMPTY, STEPS } from '@/components/client/new-order';
import { StepType } from '@/components/client/new-order/step-type';
import { StepProperty } from '@/components/client/new-order/step-property';
import { StepParties } from '@/components/client/new-order/step-parties';
import { StepTransaction } from '@/components/client/new-order/step-transaction';
import { StepContacts } from '@/components/client/new-order/step-contacts';
import { StepReview } from '@/components/client/new-order/step-review';

export default function ClientNewOrderPage() {
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
