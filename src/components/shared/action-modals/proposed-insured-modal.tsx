'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ContactDropdown,
  ContactResultButton,
  contactInitial,
  formatContactAddress,
  joinIdentity,
} from '@/components/admin/contact-picker';
import { ModalShell } from './modal-shell';
import type { ProposedInsuredInput } from '@/lib/domain/documents/proposed-insured';

interface Branch { id: number; code: string; name: string; }
interface TitleOfficer { value: string; label: string; }
interface ProposedInsuredPrefill {
  property?: { address?: string; city?: string; state?: string; zipcode?: string };
  lender?: {
    company?: string;
    companyId?: number | null;
    lookupCode?: string;
    assignmentClause?: string;
    address?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  titleOfficer?: { id: number; name: string; email: string | null; phone: string | null } | null;
  branch?: { id: number; name: string } | null;
  borrowersVesting?: string;
  loanAmount?: number;
  loanNumber?: string;
  preliminaryReportDate?: string;
  supplementalReportDate?: string;
}
interface ExistingDoc { id: number; fileName?: string | null; filename?: string | null; createdAt: string; }
interface LenderResult { id: number; companyName: string; lookupCode?: string; assignmentClause?: string; address?: string; city?: string; state?: string; zip?: string; }

export function ProposedInsuredModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor, onSuccess }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
  onSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [titleOfficers, setTitleOfficers] = useState<TitleOfficer[]>([]);
  const [titleOfficerId, setTitleOfficerId] = useState<string>('');
  const [existingDocs, setExistingDocs] = useState<ExistingDoc[]>([]);

  const [lenderType, setLenderType] = useState<'existing' | 'new'>('new');
  const [lenderCompanyId, setLenderCompanyId] = useState<number | null>(null);
  const [lenderLookupCode, setLenderLookupCode] = useState('');
  const [lenderCompany, setLenderCompany] = useState('');
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
  const [borrower, setBorrower] = useState('');
  const [supplementalDate, setSupplementalDate] = useState('');
  const [prelimDate, setPrelimDate] = useState('');

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string } | null>(null);

  const hasLender = !!lenderCompany;
  const hasProperty = !!propStreet;
  const [lenderExpanded, setLenderExpanded] = useState(true);
  const [propertyExpanded, setPropertyExpanded] = useState(true);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      setLoading(true); setResult(null); setLenderType('new');

      const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;
      const piDocsUrl = isClient ? `${base}/proposed-insured` : `${base}/documents?category=proposed_insured`;
      Promise.all([
        fetch('/api/branches').then((r) => r.ok ? r.json() : null),
        fetch('/api/form-options').then((r) => r.ok ? r.json() : null),
        fetch(`${base}/proposed-insured/prefill`).then((r) => r.ok ? r.json() : null),
        fetch(piDocsUrl).then((r) => r.ok ? r.json() : { documents: [] }),
      ]).then(([brData, formOpts, prefill, docData]) => {
        if (brData?.branches) setBranches(brData.branches);
        if (formOpts?.titleOfficers) {
          const officers = (formOpts.titleOfficers as Array<{ id: number; name?: string; email?: string }>)
            .map(t => ({ value: String(t.id), label: t.name ?? t.email ?? '' }));
          setTitleOfficers(officers);
        }
        if (docData?.documents) setExistingDocs(docData.documents);

        if (prefill) {
          const data = prefill as ProposedInsuredPrefill;
          if (data.branch?.id) setBranchId(data.branch.id);
          if (data.titleOfficer?.id) setTitleOfficerId(String(data.titleOfficer.id));
          setLenderCompanyId(data.lender?.companyId ?? null);
          setLenderLookupCode(data.lender?.lookupCode ?? '');
          setLenderType(data.lender?.companyId ? 'existing' : 'new');
          setLenderCompany(data.lender?.company ?? '');
          setAssignmentClause(data.lender?.assignmentClause ?? '');
          setLenderAddr(data.lender?.address ?? '');
          setLenderCity(data.lender?.city ?? '');
          setLenderState(data.lender?.state ?? '');
          setLenderZip(data.lender?.zipcode ?? '');
          setLoanNumber(data.loanNumber ?? '');
          setLoanAmount(data.loanAmount != null ? String(data.loanAmount) : '');
          setPropStreet(data.property?.address ?? '');
          setPropCity(data.property?.city ?? '');
          setPropState(data.property?.state ?? '');
          setPropZip(data.property?.zipcode ?? '');
          setBorrower(data.borrowersVesting ?? '');
          setSupplementalDate(toDateInput(data.supplementalReportDate) || todayInput());
          setPrelimDate(toDateInput(data.preliminaryReportDate));
          setLenderExpanded(!data.lender?.company);
          setPropertyExpanded(!data.property?.address);
        }
      }).catch(() => {}).finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, orderId, isClient]);

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
    setLenderCompanyId(l.id);
    setLenderLookupCode(l.lookupCode ?? '');
    setLenderCompany(l.companyName ?? '');
    setAssignmentClause(l.assignmentClause ?? '');
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
      const piBase = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;
      const payload: ProposedInsuredInput = {
        branchId,
        titleOfficer: titleOfficerId,
        lenderCompany,
        ...(lenderType === 'existing' && lenderCompanyId ? { lenderCompanyId } : {}),
        ...(lenderLookupCode ? { lenderCompanyLookupCode: lenderLookupCode } : {}),
        assignmentClause: assignmentClause || undefined,
        lenderAddress: lenderAddr,
        lenderCity,
        lenderState: lenderState || undefined,
        lenderZipcode: lenderZip,
        isNewLender: lenderType === 'new',
        propertyAddress: propStreet,
        propertyCity: propCity,
        propertyState: propState,
        propertyZipcode: propZip,
        loanNumber,
        loanAmount: parseMoney(loanAmount),
        borrowersVesting: borrower,
        supplementalReportDate: supplementalDate || todayInput(),
        preliminaryReportDate: prelimDate || undefined,
      };
      const res = await fetch(`${piBase}/proposed-insured`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Generation failed');
      setResult({ ok: true, docId: body.documentId });
      const piRefreshUrl = isClient ? `${piBase}/proposed-insured` : `${piBase}/documents?category=proposed_insured`;
      const r2 = await fetch(piRefreshUrl);
      const d2 = await r2.json();
      setExistingDocs(d2.documents ?? []);
      onSuccess?.();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    } finally { setGenerating(false); }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Proposed Insured" subtitle={`File #${fileNumber} — ${address}`} wide accentColor={accentColor}>
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
                  <input type="radio" name="piLenderType" checked={lenderType === 'existing'} onChange={() => setLenderType('existing')} className="accent-[#F26B2B]" />
                  Existing Lender
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="piLenderType" checked={lenderType === 'new'} onChange={() => setLenderType('new')} className="accent-[#F26B2B]" />
                  New Lender
                </label>
              </div>
              {lenderType === 'existing' && (
                <div className="relative">
                  <Inp label="Search Lender" value={lenderSearch} onChange={handleLenderSearch} placeholder="Type to search…" />
                  {lenderResults.length > 0 && (
                    <ContactDropdown>
                      {/*
                        STREET ADDRESS, not just city and state.

                        "bank of hope" returned four results, two of them
                        rendering identically as "Bank of Hope, Los Angeles, CA"
                        — nothing on screen told the operator which office they
                        were about to commit to a legal document.

                        Reusing ContactResultButton and formatContactAddress
                        rather than styling a third variant: the client selector
                        and the party picker already solve this, and a lender on
                        a CPL needs confirming at least as much as a client does.
                      */}
                      {lenderResults.map((l) => (
                        <ContactResultButton
                          key={l.id}
                          initial={contactInitial(l.companyName)}
                          title={l.companyName}
                          detail={joinIdentity([l.city, l.state])}
                          subDetail={formatContactAddress(l)}
                          onClick={() => selectLender(l)}
                        />
                      ))}
                    </ContactDropdown>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Inp label="Lender Company" value={lenderCompany} onChange={setLenderCompany} />
                <Inp label="Assignment Clause" value={assignmentClause} onChange={setAssignmentClause} />
                <Inp label="Address" value={lenderAddr} onChange={setLenderAddr} className="sm:col-span-2" />
                <Inp label="City" value={lenderCity} onChange={setLenderCity} />
                <Inp label="State" value={lenderState} onChange={setLenderState} />
                <Inp label="Zipcode" value={lenderZip} onChange={setLenderZip} />
              </div>
            </div>
          </Collapse>

          {/* ── Property ── */}
          <Collapse title="Property" complete={hasProperty && !propertyExpanded}
            summary={[propStreet, propCity, propState].filter(Boolean).join(', ')}
            expanded={propertyExpanded} onToggle={() => setPropertyExpanded(!propertyExpanded)}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label="Property Address" value={propStreet} onChange={setPropStreet} className="sm:col-span-2" />
              <Inp label="City" value={propCity} onChange={setPropCity} />
              <Inp label="State" value={propState} onChange={setPropState} />
              <Inp label="Zipcode" value={propZip} onChange={setPropZip} />
            </div>
          </Collapse>

          {/* ── Transaction ── */}
          <Section label="Transaction">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label="Loan Number" value={loanNumber} onChange={setLoanNumber} />
              <Inp label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />
              <Inp label="Primary Borrower / Vesting" value={borrower} onChange={setBorrower} className="sm:col-span-2" />
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Title Officer</label>
                <select value={titleOfficerId} onChange={(e) => setTitleOfficerId(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
                  <option value="">Select title officer…</option>
                  {titleOfficers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <Inp label="Supplemental Report Date" value={supplementalDate} onChange={setSupplementalDate} type="date" />
              <Inp label="Preliminary Report Date" value={prelimDate} onChange={setPrelimDate} type="date" />
            </div>
          </Section>

          {/* ── Branch ── */}
          <Section label="Branch">
            <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </Section>

          {/* ── Result ── */}
          {result && (
            <div className={`px-4 py-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.ok ? <span>Document generated. <a href={`${isClient ? '/api/client' : '/api'}/documents/${result.docId}/download`} className="underline font-semibold text-[#F26B2B]">Download</a></span> : result.error}
            </div>
          )}

          <button onClick={generate} disabled={!branchId || generating}
            className="w-full h-12 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {generating ? 'Generating…' : 'Generate Proposed Insured'}
          </button>

          {/* ── Existing Documents ── */}
          {existingDocs.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Existing Documents</p>
              <div className="space-y-1.5">
                {existingDocs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-sm text-[#1A1A2E] truncate">{d.fileName ?? d.filename ?? 'Proposed Insured.pdf'}</p>
                      <p className="text-xs text-[#6B7280]">{new Date(d.createdAt).toLocaleDateString()}</p>
                    </div>
                    <a href={`${isClient ? '/api/client' : '/api'}/documents/${d.id}/download`} className="text-xs font-semibold ml-3 shrink-0 text-[#F26B2B] hover:text-[#E05A1A]">Download</a>
                  </div>
                ))}
              </div>
            </div>
          )}
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

function Inp({ label, value, onChange, prefix, className = '', placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; className?: string; placeholder?: string; type?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-[#6B7280] mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">{prefix}</span>}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={`w-full h-10 ${prefix ? 'pl-7' : 'pl-3'} pr-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20`} />
      </div>
    </div>
  );
}

function parseMoney(value: string): number {
  const parsed = Number(value.replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}
