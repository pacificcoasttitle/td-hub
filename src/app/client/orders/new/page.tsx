'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Step, ClientDetails, PropertyData, SellerData, TransactionData, PartiesData, Profile } from '@/components/client/new-order';
import { EMPTY, STEPS, EMPTY_PARTY } from '@/components/client/new-order';
import { StepDetails } from '@/components/client/new-order/step-details';
import { StepProperty } from '@/components/client/new-order/step-property';
import { StepTransaction } from '@/components/client/new-order/step-transaction';
import { StepAddParties } from '@/components/client/new-order/step-add-parties';
import { StepReview } from '@/components/client/new-order/step-review';
import type { SiteXPropertyResult } from '@/components/shared/property-confirm-modal';
import { isConfidentSiteXMatch } from '@/lib/domain/titlepoint/confident-sitex';
import { buildPreInitAddressKey, usePreInitOnSiteX } from '@/lib/orders/use-pre-init-on-sitex';
import { classifySiteXOwners } from '@/lib/domain/orders/names/classify-owners';

export default function ClientNewOrderPage() {
  const [step, setStep] = useState<Step>(1);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [clientDetails, setClientDetails] = useState<ClientDetails>({
    clientType: '', emailNotifications: true,
  });
  const [property, setProperty] = useState<PropertyData>({
    street: '', city: '', state: '', zip: '', placeId: '',
    apn: '', county: '', legalDescription: '', propertyType: '',
    unitNumber: '', siteXFilled: false, searchMode: 'address',
  });
  const [seller, setSeller] = useState<SellerData>({
    primary: { ...EMPTY }, secondary: { ...EMPTY },
    hasSecondary: false, isOrg: false, orgType: '', siteXFilled: false,
  });
  const [transaction, setTransaction] = useState<TransactionData>({
    transactionType: '', productType: '', orderType: '', salesRep: '', titleOfficer: '',
    escrowNumber: '', salesAmount: '', loanNumber: '', loanAmount: '', coverageAmount: '',
    primaryBorrower: { ...EMPTY }, secondaryBorrower: { ...EMPTY },
    hasSecondaryBorrower: false, borrowerIsOrg: false, borrowerOrgType: '',
  });
  const [parties, setParties] = useState<PartiesData>({
    showAgents: false, buyerAgent: { ...EMPTY_PARTY }, listingAgent: { ...EMPTY_PARTY },
    showLender: false, lender: { ...EMPTY_PARTY },
    showEscrow: false, escrow: { ...EMPTY_PARTY },
    showEscrowOfficer: false, escrowOfficer: '',
  });
  const [, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; orderId?: number; submitLocked?: boolean } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const prevTxType = useRef<string>('');

  // Same shared OC-1 hook as Hub quick-entry — do not fork.
  const preInit = usePreInitOnSiteX();
  const invalidatePreInit = preInit.invalidateIfAddressChanged;

  useEffect(() => {
    fetch('/api/client/profile').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return;
      setProfile(d);
      const repId = d.companySalesRepId;
      const toId = d.companyTitleOfficerId;
      if (repId) setTransaction(prev => prev.salesRep ? prev : { ...prev, salesRep: String(repId) });
      if (toId) setTransaction(prev => prev.titleOfficer ? prev : { ...prev, titleOfficer: String(toId) });
    }).catch(() => {});
  }, []);

  // Invalidate stale pre-init when address fields are edited after a match.
  useEffect(() => {
    invalidatePreInit(
      buildPreInitAddressKey({
        address: property.street,
        city: property.city || 'Unknown',
        state: property.state || 'CA',
        zip: property.zip,
        apn: property.apn,
      }),
    );
  }, [property.street, property.city, property.state, property.zip, property.apn, invalidatePreInit]);

  function next() { if (step < 5) setStep((step + 1) as Step); }
  function prev() { if (step > 1) setStep((step - 1) as Step); }

  useEffect(() => {
    const now = transaction.transactionType;
    const prev = prevTxType.current;
    prevTxType.current = now;
    const nowRefi = now === 'Refinance' || now === 'Equity';
    const wasRefi = prev === 'Refinance' || prev === 'Equity';
    if (!nowRefi || wasRefi || !seller.siteXFilled) return;
    setTransaction((t) => ({
      ...t,
      primaryBorrower: { ...seller.primary },
      secondaryBorrower: { ...seller.secondary },
      hasSecondaryBorrower: seller.hasSecondary,
      borrowerIsOrg: seller.isOrg,
      borrowerOrgType: seller.orgType,
    }));
  }, [transaction.transactionType, seller.siteXFilled, seller.primary, seller.secondary, seller.hasSecondary, seller.isOrg, seller.orgType]);

  function fillOwnersFromSiteX(siteX: SiteXPropertyResult) {
    const owners = classifySiteXOwners(siteX.primaryOwner, siteX.secondaryOwner);
    if (!owners.primary) return;
    setSeller((prev) => ({
      ...prev,
      primary: owners.primary!.person,
      isOrg: owners.primary!.isOrg,
      orgType: owners.primary!.isOrg ? owners.primary!.orgType : prev.orgType,
      secondary: owners.secondary ? owners.secondary.person : prev.secondary,
      hasSecondary: !!owners.secondary || prev.hasSecondary,
      siteXFilled: true,
    }));
  }

  function handleSiteXResult(siteX: SiteXPropertyResult, propertyAfter: PropertyData) {
    fillOwnersFromSiteX(siteX);

    if (isConfidentSiteXMatch({
      apn: propertyAfter.apn || siteX.apn,
      county: propertyAfter.county || siteX.county,
      legalDescription: propertyAfter.legalDescription || siteX.legalDescription,
    })) {
      preInit.onConfidentSiteX({
        address: propertyAfter.street || siteX.fullAddress || '',
        city: propertyAfter.city || siteX.city || 'Unknown',
        state: propertyAfter.state || siteX.state || 'CA',
        county: (propertyAfter.county || siteX.county)!,
        apn: propertyAfter.apn || siteX.apn,
        legalDescription: propertyAfter.legalDescription || siteX.legalDescription,
        propertyType: propertyAfter.propertyType || siteX.propertyType,
        primaryOwner: siteX.primaryOwner,
        secondaryOwner: siteX.secondaryOwner,
        fullAddress: siteX.fullAddress,
        zip: propertyAfter.zip || siteX.zip,
      });
    } else {
      preInit.onNoSiteXMatch();
    }
  }

  function handleNoSiteXMatch() {
    preInit.onNoSiteXMatch();
  }

  async function handleSubmit() {
    if (preInit.submitBlocked || result?.submitLocked) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/client/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientDetails,
          property,
          seller,
          transaction,
          parties,
          titlePointSessionId: preInit.sessionId || undefined,
          siteXSnapshot: preInit.siteXSnapshot || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setResult({
          type: 'error',
          message: body?.error ?? `Order creation failed (${res.status})`,
          orderId: body?.orderId,
          submitLocked: body?.submitLocked === true || body?.createdInSoftPro === true,
        });
        return;
      }
      setResult({ type: 'success', message: `Order ${body.fileNumber ?? body.orderId ?? ''} created.`, orderId: body.orderId });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!property.apn) { setDuplicateWarning(null); return; }
    const timeout = setTimeout(() => {
      fetch(`/api/orders?apn=${encodeURIComponent(property.apn)}&pageSize=1`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.orders?.length > 0) {
            setDuplicateWarning(`An order with APN ${property.apn} already exists (File #${d.orders[0].fileNumber}). Please verify this isn't a duplicate.`);
          } else {
            setDuplicateWarning(null);
          }
        })
        .catch(() => setDuplicateWarning(null));
    }, 500);
    return () => clearTimeout(timeout);
  }, [property.apn]);

  if (result?.type === 'success' && result.orderId) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
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
            <p className="text-sm text-[#1B2A4A]">{result.message}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href={`/client/orders/${result.orderId}`} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors min-h-[48px]">
                View Order Timeline
              </Link>
              <Link href="/client/dashboard" className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium border border-[#E5E7EB] text-[#4B5563] rounded-lg hover:bg-[#F3F4F6] transition-colors min-h-[48px]">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/client/dashboard" className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] transition-colors mb-6 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to Dashboard
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-[#1B2A4A] mb-2">Open New Order</h1>
        <p className="text-[#4B5563]">Complete the form below to submit your title order</p>
      </div>

      {profile && (
        <div className="bg-[#1B2A4A]/5 border border-[#1B2A4A]/10 rounded-xl px-5 py-4 mb-8 flex items-center gap-3">
          <div className="h-9 w-9 bg-[#1B2A4A] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{profile.displayName?.charAt(0)?.toUpperCase() ?? 'U'}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1B2A4A]">Opening as: {profile.displayName}</p>
            <p className="text-xs text-[#4B5563] truncate">{profile.email}{profile.company ? ` · ${profile.company}` : ''}</p>
          </div>
        </div>
      )}

      {/* Progress Steps */}
      <div className="mb-10">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const isComplete = s.n < step;
            const isCurrent = s.n === step;
            return (
              <div key={s.n} className="flex items-center">
                <button
                  onClick={() => { if (s.n < step) setStep(s.n); }}
                  disabled={s.n > step}
                  className={`flex flex-col items-center gap-2 transition-all ${s.n <= step ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all text-sm font-bold ${
                    isComplete ? 'bg-[#1B2A4A] text-white' : isCurrent ? 'bg-[#F26B2B] text-white' : 'bg-[#F3F4F6] text-[#9CA3AF]'
                  }`}>
                    {isComplete ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    ) : s.n}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${isCurrent ? 'text-[#F26B2B]' : 'text-[#4B5563]'}`}>
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 sm:w-16 h-0.5 mx-1 sm:mx-2 ${isComplete ? 'bg-[#1B2A4A]' : 'bg-[#E5E7EB]'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          {step === 1 && <StepDetails profile={profile} data={clientDetails} onChange={setClientDetails} onNext={next} />}
          {step === 2 && (
            <StepProperty
              data={property}
              onChange={setProperty}
              onSiteXResult={handleSiteXResult}
              onNoSiteXMatch={handleNoSiteXMatch}
              onNext={next}
              onPrev={prev}
            />
          )}
          {step === 3 && (
            <StepTransaction
              data={transaction}
              onChange={setTransaction}
              seller={seller}
              onSellerChange={setSeller}
              onNext={next}
              onPrev={prev}
            />
          )}
          {step === 4 && <StepAddParties data={parties} onChange={setParties} orderTypeValue={transaction.orderType} clientType={clientDetails.clientType} transactionType={transaction.transactionType} onNext={next} onPrev={prev} />}
          {step === 5 && (
            <StepReview
              clientDetails={clientDetails} property={property} seller={seller}
              transaction={transaction} parties={parties}
              submitting={submitting}
              submitBlocked={preInit.submitBlocked}
              preparingLabel={preInit.preparingLabel}
              preInitPhase={preInit.phase}
              error={result?.type === 'error' ? result.message : null}
              duplicateWarning={duplicateWarning}
              submitLocked={result?.submitLocked === true}
              onSubmit={handleSubmit} onPrev={prev} onGoTo={setStep}
              onFilesChange={setFiles}
            />
          )}
        </div>
      </div>
    </div>
  );
}
