'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StepSelectOrder, OrderSummaryBanner, SummaryField } from './step-select-order';
import type { OrderResult } from './step-select-order';
import { CplLenderForm } from './cpl-lender-form';
import type { LenderInfo } from './cpl-lender-form';
import type { Underwriter } from '@/lib/integrations/cpl/types';

interface CplBranch {
  id: number;
  branchName: string | null;
  agencyName: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

const UNDERWRITERS: { value: Underwriter; label: string; description: string }[] = [
  { value: 'westcor', label: 'Westcor', description: 'REST/JSON · OAuth2' },
  { value: 'fnf', label: 'FNF / Commonwealth', description: 'SOAP/XML · Two-tier JWT' },
  { value: 'natic', label: 'NATIC', description: 'XML/HTTP' },
  { value: 'doma', label: 'Doma', description: 'XML/HTTP' },
];

export function CplWizard({ prefilledOrderId }: { prefilledOrderId: string | null }) {
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [underwriter, setUnderwriter] = useState<Underwriter | null>(null);
  const [branches, setBranches] = useState<CplBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<CplBranch | null>(null);
  const [lender, setLender] = useState<LenderInfo>({
    companyName: '', contactName: '', address: '', city: '', state: '', zip: '', assignmentClause: '',
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!prefilledOrderId) return;
    fetch(`/api/orders/${prefilledOrderId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((order) => {
        if (order) {
          setSelectedOrder({ id: order.id, fileNumber: order.fileNumber, operationalStatus: order.operationalStatus, property: order.property });
          setStep(2);
        }
      })
      .catch(() => {});
  }, [prefilledOrderId]);

  useEffect(() => {
    if (!underwriter) { setBranches([]); setSelectedBranch(null); return; }
    fetch(`/api/vendor-actions/cpl/branches?underwriter=${underwriter}`)
      .then((r) => r.ok ? r.json() : { branches: [] })
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([]));
  }, [underwriter]);

  function handleSelectOrder(order: OrderResult) { setSelectedOrder(order); setStep(2); }
  function handleSelectUnderwriter(uw: Underwriter) { setUnderwriter(uw); setSelectedBranch(null); setStep(3); }
  function handleSelectBranch(branch: CplBranch) { setSelectedBranch(branch); setStep(4); }

  async function handleGenerate() {
    if (!selectedOrder || !underwriter || !selectedBranch) return;
    setGenerating(true);
    setResult(null);
    try {
      const hasOverrides = Object.values(lender).some((v) => v.trim());
      const res = await fetch('/api/vendor-actions/cpl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id, underwriter, branchId: selectedBranch.id, cplMode: 'single',
          ...(hasOverrides ? { lenderOverrides: lender } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }
      setResult({ type: 'success', message: 'CPL generated successfully.' });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'CPL generation failed' });
    } finally {
      setGenerating(false);
    }
  }

  function handleReset() {
    setStep(1); setSelectedOrder(null); setUnderwriter(null); setSelectedBranch(null);
    setBranches([]); setLender({ companyName: '', contactName: '', address: '', city: '', state: '', zip: '', assignmentClause: '' });
    setResult(null);
  }

  const steps = [
    { n: 1, label: 'Order' }, { n: 2, label: 'Underwriter' }, { n: 3, label: 'Branch' },
    { n: 4, label: 'Lender Info' }, { n: 5, label: 'Generate' },
  ];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1 mb-8">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1">
            <button
              onClick={() => { if (s.n < step) setStep(s.n as WizardStep); }}
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
            {i < steps.length - 1 && <div className="w-4 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {step === 1 && <StepSelectOrder onSelect={handleSelectOrder} />}
        {step === 2 && <StepSelectUnderwriter order={selectedOrder!} selected={underwriter} onSelect={handleSelectUnderwriter} />}
        {step === 3 && <StepSelectBranch underwriter={underwriter!} branches={branches} selected={selectedBranch} onSelect={handleSelectBranch} />}
        {step === 4 && <CplLenderForm lender={lender} setLender={setLender} onProceed={() => setStep(5)} />}
        {step === 5 && (
          <StepGenerate order={selectedOrder!} underwriter={underwriter!} branch={selectedBranch!}
            generating={generating} result={result} onGenerate={handleGenerate} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}

function StepSelectUnderwriter({
  order, selected, onSelect,
}: {
  order: OrderResult; selected: Underwriter | null; onSelect: (uw: Underwriter) => void;
}) {
  return (
    <div className="p-6">
      <OrderSummaryBanner order={order} />
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1 mt-5">Select Underwriter</h3>
      <p className="text-sm text-[#6B7280] mb-4">Choose the underwriter for CPL generation</p>
      <div className="grid grid-cols-2 gap-3">
        {UNDERWRITERS.map((uw) => (
          <button
            key={uw.value}
            onClick={() => onSelect(uw.value)}
            className={`text-left px-4 py-4 rounded-lg border-2 transition-colors ${
              selected === uw.value ? 'border-[#C5A55A] bg-[#C5A55A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/30'
            }`}
          >
            <p className="font-semibold text-[#1A1A2E]">{uw.label}</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{uw.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepSelectBranch({
  underwriter, branches, selected, onSelect,
}: {
  underwriter: Underwriter; branches: CplBranch[]; selected: CplBranch | null; onSelect: (b: CplBranch) => void;
}) {
  const uwLabel = UNDERWRITERS.find((u) => u.value === underwriter)?.label ?? underwriter;
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1">Select Branch</h3>
      <p className="text-sm text-[#6B7280] mb-4">{uwLabel} branches available for CPL</p>
      {branches.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-[#6B7280]">No branches configured for {uwLabel}.</p>
          <p className="text-xs text-[#6B7280] mt-1">Check Settings → Provider Mappings.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelect(b)}
              className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                selected?.id === b.id ? 'border-[#C5A55A] bg-[#C5A55A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/30'
              }`}
            >
              <p className="font-medium text-[#1A1A2E]">{b.branchName ?? b.agencyName ?? 'Branch'}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">{[b.city, b.state].filter(Boolean).join(', ') || 'No location'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepGenerate({
  order, underwriter, branch, generating, result, onGenerate, onReset,
}: {
  order: OrderResult; underwriter: Underwriter; branch: CplBranch;
  generating: boolean; result: { type: 'success' | 'error'; message: string } | null;
  onGenerate: () => void; onReset: () => void;
}) {
  const uwLabel = UNDERWRITERS.find((u) => u.value === underwriter)?.label ?? underwriter;
  const addr = [order.property?.address, order.property?.city].filter(Boolean).join(', ');
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Review &amp; Generate</h3>
      <div className="grid grid-cols-2 gap-4 text-sm mb-6">
        <SummaryField label="Order" value={order.fileNumber} sub={addr || undefined} />
        <SummaryField label="Underwriter" value={uwLabel} />
        <SummaryField label="Branch" value={branch.branchName ?? 'Selected'} sub={[branch.city, branch.state].filter(Boolean).join(', ') || undefined} />
        <SummaryField label="Mode" value="Single Transaction" />
      </div>
      {result && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          result.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <p className="font-medium">{result.message}</p>
          {result.type === 'success' && (
            <Link href={`/orders/${order.id}?tab=Documents`} className="text-green-800 underline text-xs mt-1 inline-block">
              View in Documents tab →
            </Link>
          )}
          {result.type === 'error' && (
            <p className="text-xs mt-1">We are aware of the error and our customer service team will be contacting you shortly.</p>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        {!result?.type || result.type === 'error' ? (
          <button onClick={onGenerate} disabled={generating}
            className="px-5 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2">
            {generating && (
              <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {generating ? 'Generating CPL…' : 'Generate CPL'}
          </button>
        ) : null}
        <button onClick={onReset} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          {result?.type === 'success' ? 'Generate Another' : 'Start Over'}
        </button>
      </div>
    </div>
  );
}
