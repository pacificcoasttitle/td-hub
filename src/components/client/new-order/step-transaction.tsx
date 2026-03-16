'use client';

import { useEffect, useState } from 'react';
import type { TransactionData, FormOption } from './types';
import { IN, SEL, EMPTY, ORG_TYPES, TRANSACTION_TYPES } from './types';
import { SH, FL, Nav, CurrInput, PF } from './shared';

interface FetchedOptions {
  productTypes: FormOption[];
  orderTypes: FormOption[];
  salesReps: FormOption[];
  titleOfficers: FormOption[];
}

export function StepTransaction({ data, onChange, onNext, onPrev }: {
  data: TransactionData;
  onChange: (d: TransactionData) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const [options, setOptions] = useState<FetchedOptions | null>(null);

  useEffect(() => {
    fetch('/api/form-options')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const toOpt = (arr: Array<{ id?: number; name?: string; value?: string; label?: string; email?: string }>) =>
          (arr ?? []).map((r) => ({ value: r.value ?? String(r.id ?? ''), label: r.label ?? r.name ?? r.email ?? '' }));
        setOptions({
          productTypes: d.productTypes ?? [],
          orderTypes: d.orderTypes ?? [],
          salesReps: toOpt(d.salesReps),
          titleOfficers: toOpt(d.titleOfficers),
        });
      })
      .catch(() => {});
  }, []);

  const isPurchase = data.transactionType === 'Purchase';
  const isRefi = data.transactionType === 'Refinance';

  return (
    <div className="p-5 sm:p-6">
      <SH title="Transaction Details" sub="Enter financial and transaction information." />

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FL>Transaction Type</FL>
            <select
              value={data.transactionType}
              onChange={(e) => onChange({ ...data, transactionType: e.target.value })}
              className={SEL}
            >
              {TRANSACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <FL>Product Type</FL>
            {options?.productTypes?.length ? (
              <select value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} className={SEL}>
                <option value="">Select…</option>
                {options.productTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} placeholder="Standard, Commercial…" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FL>Order Type</FL>
            {options?.orderTypes?.length ? (
              <select value={data.orderType} onChange={(e) => onChange({ ...data, orderType: e.target.value })} className={SEL}>
                <option value="">Select…</option>
                {options.orderTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={data.orderType} onChange={(e) => onChange({ ...data, orderType: e.target.value })} placeholder="Order type" />
            )}
          </div>
          <div>
            <FL>Escrow Number</FL>
            <input className={IN} value={data.escrowNumber} onChange={(e) => onChange({ ...data, escrowNumber: e.target.value })} placeholder="Optional" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FL>Sales Rep</FL>
            {options?.salesReps?.length ? (
              <select value={data.salesRep} onChange={(e) => onChange({ ...data, salesRep: e.target.value })} className={SEL}>
                <option value="">Select…</option>
                {options.salesReps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={data.salesRep} onChange={(e) => onChange({ ...data, salesRep: e.target.value })} placeholder="Sales rep" />
            )}
          </div>
          <div>
            <FL>Title Officer</FL>
            {options?.titleOfficers?.length ? (
              <select value={data.titleOfficer} onChange={(e) => onChange({ ...data, titleOfficer: e.target.value })} className={SEL}>
                <option value="">Select…</option>
                {options.titleOfficers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className={IN} value={data.titleOfficer} onChange={(e) => onChange({ ...data, titleOfficer: e.target.value })} placeholder="Title officer" />
            )}
          </div>
        </div>

        {isPurchase && (
          <>
            <div><FL>Sales Amount</FL><CurrInput value={data.salesAmount} onChange={(v) => onChange({ ...data, salesAmount: v })} /></div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Primary Borrower</p>
              <PF person={data.primaryBorrower} onChange={(f, v) => onChange({ ...data, primaryBorrower: { ...data.primaryBorrower, [f]: v } })} />
              {!data.hasSecondaryBorrower ? (
                <button
                  onClick={() => onChange({ ...data, hasSecondaryBorrower: true })}
                  className="mt-2 text-sm font-medium text-[#1B2A4A] min-h-[44px] flex items-center gap-1"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add secondary borrower
                </button>
              ) : (
                <div className="mt-3 pl-3 border-l-2 border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-[#6B7280]">Secondary Borrower</p>
                    <button onClick={() => onChange({ ...data, hasSecondaryBorrower: false, secondaryBorrower: { ...EMPTY } })} className="text-xs text-red-500 min-h-[44px]">Remove</button>
                  </div>
                  <PF person={data.secondaryBorrower} onChange={(f, v) => onChange({ ...data, secondaryBorrower: { ...data.secondaryBorrower, [f]: v } })} />
                </div>
              )}
              <label className="flex items-center gap-2 mt-3 min-h-[44px]">
                <input type="checkbox" checked={data.borrowerIsOrg} onChange={(e) => onChange({ ...data, borrowerIsOrg: e.target.checked })} className="rounded border-gray-300 text-[#F26B2B] h-4 w-4 focus:ring-[#F26B2B]/40" />
                <span className="text-xs text-[#6B7280]">Borrower is an organization</span>
              </label>
              {data.borrowerIsOrg && (
                <div className="mt-2">
                  <FL>Organization Type</FL>
                  <select value={data.borrowerOrgType} onChange={(e) => onChange({ ...data, borrowerOrgType: e.target.value })} className={SEL}>
                    <option value="">Select…</option>
                    {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
          </>
        )}

        {isRefi && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div><FL>Loan Number</FL><input className={IN} value={data.loanNumber} onChange={(e) => onChange({ ...data, loanNumber: e.target.value })} /></div>
              <div><FL>Loan Amount</FL><CurrInput value={data.loanAmount} onChange={(v) => onChange({ ...data, loanAmount: v })} /></div>
            </div>
            <div><FL>Coverage Amount</FL><CurrInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} /></div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Primary Borrower</p>
              <PF person={data.primaryBorrower} onChange={(f, v) => onChange({ ...data, primaryBorrower: { ...data.primaryBorrower, [f]: v } })} />
            </div>
          </>
        )}

        {!isPurchase && !isRefi && data.transactionType && (
          <div><FL>Coverage Amount</FL><CurrInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} /></div>
        )}
      </div>

      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.transactionType} />
    </div>
  );
}
