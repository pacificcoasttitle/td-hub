'use client';

import { useState, useEffect, useRef } from 'react';
import { ModalShell } from './modal-shell';

interface Branch { id: number; code: string; name: string; }
interface OrderData {
  transactionType?: string; branchId?: number;
  lenderCompanyName?: string; lenderName?: string; lenderAddress?: string;
  lenderCity?: string; lenderState?: string; lenderZip?: string;
  loanNumber?: string; loanAmount?: string; salesPrice?: string;
  buyerFirstName?: string; buyerLastName?: string;
  secondaryBuyerFirstName?: string; secondaryBuyerLastName?: string;
  propertyStreet?: string; propertyCity?: string; propertyState?: string; propertyZip?: string;
}
interface ExistingCpl { id: number; fileName: string; createdAt: string; }
interface LenderResult { id: number; companyName: string; address?: string; city?: string; state?: string; zip?: string; }

export function CplModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [txType, setTxType] = useState('');
  const [existingCpls, setExistingCpls] = useState<ExistingCpl[]>([]);

  const [lenderType, setLenderType] = useState<'existing' | 'new'>('new');
  const [lenderCompany, setLenderCompany] = useState('');
  const [lenderContact, setLenderContact] = useState('');
  const [assignmentClause, setAssignmentClause] = useState('');
  const [lenderAddr, setLenderAddr] = useState('');
  const [lenderCity, setLenderCity] = useState('');
  const [lenderState, setLenderState] = useState('');
  const [lenderZip, setLenderZip] = useState('');
  const [lenderSearch, setLenderSearch] = useState('');
  const [lenderResults, setLenderResults] = useState<LenderResult[]>([]);
  const lenderDebRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [propStreet, setPropStreet] = useState('');
  const [propCity, setPropCity] = useState('');
  const [propState, setPropState] = useState('');
  const [propZip, setPropZip] = useState('');

  const [loanNumber, setLoanNumber] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [salesAmount, setSalesAmount] = useState('');
  const [borrower, setBorrower] = useState('');

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string } | null>(null);

  const hasLender = !!(lenderCompany);
  const hasProperty = !!(propStreet);
  const [lenderExpanded, setLenderExpanded] = useState(true);
  const [propertyExpanded, setPropertyExpanded] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setResult(null); setLenderType('new');

    Promise.all([
      fetch('/api/branches').then((r) => r.ok ? r.json() : null),
      fetch(`/api/orders/${orderId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/orders/${orderId}/documents?category=cpl`).then((r) => r.ok ? r.json() : { documents: [] }),
    ]).then(([brData, od, docData]) => {
      if (brData?.branches) setBranches(brData.branches);
      if (docData?.documents) setExistingCpls(docData.documents);

      if (od) {
        const o = od as OrderData;
        if (o.branchId) setBranchId(o.branchId);
        setTxType(o.transactionType ?? '');
        setLenderCompany(o.lenderCompanyName ?? '');
        setLenderContact(o.lenderName ?? '');
        setLenderAddr(o.lenderAddress ?? '');
        setLenderCity(o.lenderCity ?? '');
        setLenderState(o.lenderState ?? '');
        setLenderZip(o.lenderZip ?? '');
        setLoanNumber(o.loanNumber ?? '');
        setLoanAmount(o.loanAmount ?? '');
        setSalesAmount(o.salesPrice ?? '');
        setPropStreet(o.propertyStreet ?? '');
        setPropCity(o.propertyCity ?? '');
        setPropState(o.propertyState ?? '');
        setPropZip(o.propertyZip ?? '');
        const buyers = [
          [o.buyerFirstName, o.buyerLastName].filter(Boolean).join(' '),
          [o.secondaryBuyerFirstName, o.secondaryBuyerLastName].filter(Boolean).join(' '),
        ].filter(Boolean).join(', ');
        setBorrower(buyers);
        setLenderExpanded(!o.lenderCompanyName);
        setPropertyExpanded(!o.propertyStreet);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open, orderId]);

  function handleLenderSearch(v: string) {
    setLenderSearch(v);
    clearTimeout(lenderDebRef.current);
    if (v.length < 2) { setLenderResults([]); return; }
    lenderDebRef.current = setTimeout(() => {
      fetch(`/api/contacts/search?q=${encodeURIComponent(v)}&type=lender`)
        .then((r) => r.ok ? r.json() : { results: [] })
        .then((d) => setLenderResults(d.results ?? d.contacts ?? []))
        .catch(() => setLenderResults([]));
    }, 250);
  }

  function selectLender(l: LenderResult) {
    setLenderCompany(l.companyName ?? '');
    setLenderAddr(l.address ?? '');
    setLenderCity(l.city ?? '');
    setLenderState(l.state ?? '');
    setLenderZip(l.zip ?? '');
    setLenderSearch(''); setLenderResults([]);
  }

  async function generate() {
    if (!branchId) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/vendor-actions/cpl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId, underwriter: 'westcor', branchId,
          lenderCompany, lenderContact, assignmentClause,
          lenderAddress: lenderAddr, lenderCity, lenderState, lenderZip,
          propertyAddress: propStreet, propertyCity: propCity, propertyState: propState, propertyZip: propZip,
          loanNumber, loanAmount, salesAmount, borrowerNames: borrower,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Generation failed');
      setResult({ ok: true, docId: body.documentId });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    } finally { setGenerating(false); }
  }

  const isRegen = existingCpls.length > 0;

  return (
    <ModalShell open={open} onClose={onClose} title="Generate CPL" subtitle={`File #${fileNumber} — ${address}`} wide>
      {loading ? (
        <div className="p-10 text-center">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#6B7280] mt-3">Loading order data…</p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* ── Lender ── */}
          <Collapse title="Lender Information" complete={hasLender && !lenderExpanded} summary={lenderCompany}
            expanded={lenderExpanded} onToggle={() => setLenderExpanded(!lenderExpanded)}>
            <div className="space-y-3">
              <div className="flex gap-4 mb-2">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="lenderType" checked={lenderType === 'existing'} onChange={() => setLenderType('existing')} className="accent-[#F26B2B]" />
                  Existing Lender
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="lenderType" checked={lenderType === 'new'} onChange={() => setLenderType('new')} className="accent-[#F26B2B]" />
                  New Lender
                </label>
              </div>
              {lenderType === 'existing' && (
                <div className="relative">
                  <F label="Search Lender" value={lenderSearch} onChange={handleLenderSearch} placeholder="Type to search…" />
                  {lenderResults.length > 0 && (
                    <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {lenderResults.map((l) => (
                        <button key={l.id} onClick={() => selectLender(l)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                          <span className="font-medium text-[#1A1A2E]">{l.companyName}</span>
                          {l.city && <span className="text-[#6B7280] ml-2 text-xs">{l.city}, {l.state}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <F label="Lender Company" value={lenderCompany} onChange={setLenderCompany} />
                <F label="Lender Name / Attention" value={lenderContact} onChange={setLenderContact} />
                <F label="Assignment Clause" value={assignmentClause} onChange={setAssignmentClause} className="sm:col-span-2" />
                <F label="Address" value={lenderAddr} onChange={setLenderAddr} className="sm:col-span-2" />
                <F label="City" value={lenderCity} onChange={setLenderCity} />
                <F label="State" value={lenderState} onChange={setLenderState} />
                <F label="Zipcode" value={lenderZip} onChange={setLenderZip} />
              </div>
            </div>
          </Collapse>

          {/* ── Property ── */}
          <Collapse title="Property" complete={hasProperty && !propertyExpanded}
            summary={[propStreet, propCity, propState].filter(Boolean).join(', ')}
            expanded={propertyExpanded} onToggle={() => setPropertyExpanded(!propertyExpanded)}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <F label="Property Address" value={propStreet} onChange={setPropStreet} className="sm:col-span-2" />
              <F label="City" value={propCity} onChange={setPropCity} />
              <F label="State" value={propState} onChange={setPropState} />
              <F label="Zipcode" value={propZip} onChange={setPropZip} />
            </div>
          </Collapse>

          {/* ── Transaction ── */}
          <Section label="Transaction">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <F label="Loan Number" value={loanNumber} onChange={setLoanNumber} />
              {txType === 'refinance' && <F label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />}
              {txType === 'purchase' && <F label="Sales Amount" value={salesAmount} onChange={setSalesAmount} prefix="$" />}
              {!txType && (
                <>
                  <F label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />
                  <F label="Sales Amount" value={salesAmount} onChange={setSalesAmount} prefix="$" />
                </>
              )}
              <F label="Primary Borrower / Vesting" value={borrower} onChange={setBorrower} className="sm:col-span-2" />
            </div>
          </Section>

          {/* ── Branch ── */}
          <Section label="Branch">
            <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
            <p className="text-[11px] text-[#9CA3AF] mt-1">Underwriter: Westcor (default)</p>
          </Section>

          {/* ── Result ── */}
          {result && (
            <div className={`px-4 py-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.ok ? <span>CPL generated. <a href={`/api/documents/${result.docId}/download`} className="underline font-semibold text-[#F26B2B]">Download CPL</a></span> : result.error}
            </div>
          )}

          {isRegen && !result && (
            <div className="px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200">
              A CPL already exists for this order. Generating will create a new version.
            </div>
          )}

          <button onClick={generate} disabled={!branchId || generating}
            className="w-full h-12 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {generating ? 'Generating…' : isRegen ? 'Regenerate CPL' : 'Generate CPL'}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/* ── Collapsible Section ── */

function Collapse({ title, complete, summary, expanded, onToggle, children }: {
  title: string; complete: boolean; summary: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <div className="flex items-center gap-2">
          {complete && <svg className="h-4 w-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>}
          <span className="text-xs font-semibold uppercase tracking-wider text-[#1A1A2E]">{title}</span>
          {complete && <span className="text-xs text-[#6B7280] truncate max-w-[200px]">{summary}</span>}
        </div>
        {complete && <span className="text-xs font-medium text-[#F26B2B]">Edit</span>}
        <svg className={`h-4 w-4 text-[#6B7280] transition-transform ml-2 shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {expanded && <div className="p-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>{children}</div>;
}

function F({ label, value, onChange, prefix, className = '', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; className?: string; placeholder?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-[#6B7280] mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">{prefix}</span>}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={`w-full h-10 ${prefix ? 'pl-7' : 'pl-3'} pr-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20`} />
      </div>
    </div>
  );
}
