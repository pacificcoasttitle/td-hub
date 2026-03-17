'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

const UNDERWRITERS = [
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF' },
  { value: 'natic', label: 'NATIC' },
];

interface Branch { id: number; code: string; name: string; }

interface OrderCplData {
  underwriter?: string;
  branchId?: number;
  lenderCompanyName?: string;
  lenderName?: string;
  lenderAddress?: string;
  loanNumber?: string;
  loanAmount?: string;
  salesPrice?: string;
  buyerFirstName?: string;
  buyerLastName?: string;
  secondaryBuyerFirstName?: string;
  secondaryBuyerLastName?: string;
  propertyStreet?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
}

export function CplModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
}) {
  const [underwriter, setUnderwriter] = useState('');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [lenderCompany, setLenderCompany] = useState('');
  const [lenderContact, setLenderContact] = useState('');
  const [lenderAddress, setLenderAddress] = useState('');
  const [loanNumber, setLoanNumber] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [salesAmount, setSalesAmount] = useState('');
  const [borrowerNames, setBorrowerNames] = useState('');
  const [propertyAddr, setPropertyAddr] = useState('');

  const [cplMode, setCplMode] = useState<'single' | 'multiple'>('single');
  const [protectLender, setProtectLender] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string } | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null); setLoadingOrder(true);

    Promise.all([
      fetch('/api/branches').then((r) => r.ok ? r.json() : null),
      fetch(`/api/orders/${orderId}`).then((r) => r.ok ? r.json() : null),
    ]).then(([branchData, order]) => {
      if (branchData?.branches) setBranches(branchData.branches);

      if (order) {
        const od = order as OrderCplData;
        if (od.underwriter) setUnderwriter(od.underwriter.toLowerCase());
        if (od.branchId) setBranchId(od.branchId);
        setLenderCompany(od.lenderCompanyName ?? '');
        setLenderContact(od.lenderName ?? '');
        setLenderAddress(od.lenderAddress ?? '');
        setLoanNumber(od.loanNumber ?? '');
        setLoanAmount(od.loanAmount ?? '');
        setSalesAmount(od.salesPrice ?? '');
        const buyers = [
          [od.buyerFirstName, od.buyerLastName].filter(Boolean).join(' '),
          [od.secondaryBuyerFirstName, od.secondaryBuyerLastName].filter(Boolean).join(' '),
        ].filter(Boolean).join(', ');
        setBorrowerNames(buyers);
        const pAddr = [od.propertyStreet, od.propertyCity, od.propertyState, od.propertyZip].filter(Boolean).join(', ');
        setPropertyAddr(pAddr);
      }
    }).catch(() => {}).finally(() => setLoadingOrder(false));
  }, [open, orderId]);

  async function generate() {
    if (!underwriter || !branchId) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/vendor-actions/cpl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId, underwriter, branchId, cplMode, protectLender,
          lenderCompany, lenderContact, lenderAddress,
          loanNumber, loanAmount, salesAmount,
          borrowerNames, propertyAddress: propertyAddr,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Generation failed');
      setResult({ ok: true, docId: body.documentId });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    } finally { setGenerating(false); }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Generate CPL" subtitle={`${fileNumber} · ${address}`} wide>
      {loadingOrder ? (
        <div className="p-10 text-center">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#6B7280] mt-3">Loading order data…</p>
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Underwriter */}
          <Section label="Underwriter">
            <div className="grid grid-cols-3 gap-2">
              {UNDERWRITERS.map((u) => (
                <button key={u.value} onClick={() => setUnderwriter(u.value)}
                  className={`px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    underwriter === u.value
                      ? 'border-[#F26B2B] bg-[#F26B2B]/10 text-[#1A1A2E]'
                      : 'border-gray-200 text-[#4B5563] hover:border-gray-300'
                  }`}
                >{u.label}</button>
              ))}
            </div>
          </Section>

          {/* Branch */}
          <Section label="Branch">
            <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </Section>

          {/* Editable Fields */}
          <Section label="Lender & Loan Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Lender Company" value={lenderCompany} onChange={setLenderCompany} />
              <Field label="Lender Contact Name" value={lenderContact} onChange={setLenderContact} />
              <Field label="Lender Address" value={lenderAddress} onChange={setLenderAddress} className="sm:col-span-2" />
              <Field label="Loan Number" value={loanNumber} onChange={setLoanNumber} />
              <Field label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />
              <Field label="Purchase Price / Sales Amount" value={salesAmount} onChange={setSalesAmount} prefix="$" />
              <Field label="Borrower Name(s)" value={borrowerNames} onChange={setBorrowerNames} />
            </div>
          </Section>

          <Section label="Property Address">
            <input value={propertyAddr} onChange={(e) => setPropertyAddr(e.target.value)}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20" />
          </Section>

          {/* CPL Options */}
          <Section label="CPL Options">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="text-sm text-[#4B5563]">Mode:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="cplMode" checked={cplMode === 'single'} onChange={() => setCplMode('single')}
                    className="accent-[#F26B2B]" />
                  <span className="text-sm">Single</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="cplMode" checked={cplMode === 'multiple'} onChange={() => setCplMode('multiple')}
                    className="accent-[#F26B2B]" />
                  <span className="text-sm">Multiple</span>
                </label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={protectLender} onChange={(e) => setProtectLender(e.target.checked)}
                  className="accent-[#F26B2B] w-4 h-4 rounded" />
                <span className="text-sm text-[#4B5563]">Protect Lender</span>
              </label>
            </div>
          </Section>

          {/* Result */}
          {result && (
            <div className={`px-4 py-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.ok ? <span>CPL generated successfully. <a href={`/api/documents/${result.docId}/download`} className="underline font-semibold text-[#F26B2B]">Download CPL</a></span> : result.error}
            </div>
          )}

          {/* Generate */}
          <button onClick={generate} disabled={!underwriter || !branchId || generating}
            className="w-full h-12 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {generating ? 'Generating…' : 'Generate CPL'}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, prefix, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-[#6B7280] mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">{prefix}</span>}
        <input value={value} onChange={(e) => onChange(e.target.value)}
          className={`w-full h-10 ${prefix ? 'pl-7' : 'pl-3'} pr-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20`} />
      </div>
    </div>
  );
}
