'use client';

import { useState, useEffect, useRef } from 'react';
import { ModalShell } from './modal-shell';

type Underwriter = 'westcor' | 'fnf';

interface CplBranch { id: number; code: string; name: string; underwriter: string; underwriterCode: string; }

interface OrderApiResponse {
  transactionType?: string | null;
  productType?: string | null;
  underwriterId?: number | null;
  branchId?: number | null;
  salesPrice?: string | null;
  loanAmount?: string | null;
  property?: {
    address?: string | null; city?: string | null;
    state?: string | null; zip?: string | null;
  } | null;
  parties?: Array<{
    role: string; externalName?: string | null;
    externalCompany?: string | null; isPrimary?: boolean;
  }>;
  lenderContact?: {
    companyName?: string | null; fullName?: string | null;
    address1?: string | null; city?: string | null;
    state?: string | null; zip?: string | null;
    assignmentClause?: string | null;
  } | null;
  cplData?: Record<string, string>;
  underwriter?: { name?: string; lookupCode?: string } | null;
}

interface ExistingCpl {
  id: number;
  fileName?: string | null;
  filename?: string | null;
  createdAt: string;
}
interface LenderResult { id: number; companyName: string; address?: string; city?: string; state?: string; zip?: string; }

const UNDERWRITER_LABELS: Record<Underwriter, string> = {
  westcor: 'Westcor',
  fnf: 'FNF / Commonwealth',
};

/**
 * Auto-detect underwriter from order data:
 *   Full ALTA product type → fnf (Commonwealth)
 *   CW underwriter company → fnf (Commonwealth)
 *   Everything else → westcor
 */
function detectUnderwriter(order: OrderApiResponse): Underwriter {
  const product = (order.productType ?? '').toLowerCase();
  if (product === 'full alta') return 'fnf';

  const uwName = (order.underwriter?.name ?? '').toUpperCase();
  const uwCode = (order.underwriter?.lookupCode ?? '').toUpperCase();
  if (uwName === 'CW' || uwCode === 'CW') return 'fnf';

  return 'westcor';
}


// ─── Say what actually went wrong ───────────────────────────────────────────
//
// Every failure branch of the CPL route returns a GENERIC `error` plus the
// specific reason in `details`:
//
//   { error: 'CPL generation failed', details: result.errors }   // 422
//   { error: 'Invalid parameters',    details: err.issues }      // 400
//   { error: 'Internal server error' }                           // 500
//
// This read `body.error ?? body.details?.[0]`. `??` only falls through on
// null/undefined, and `error` is always a non-empty literal — so `details` was
// unreachable and the operator was told "CPL generation failed" while the real
// reason ("PolicyProducingAgentNumber is missing, validation failed for the
// Agency") went to cpl_error_logs and nowhere else. Reading a log table to find
// out why a button did not work is the loop this whole panel exists to close.
//
// The specific reason now wins, with the generic label kept only when there is
// nothing better.

/** Zod issues are objects; vendor errors are strings. Render either. */
export function detailStrings(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .map((d) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        const o = d as { message?: unknown; path?: unknown };
        if (typeof o.message === 'string') {
          const path = Array.isArray(o.path) && o.path.length ? `${o.path.join('.')}: ` : '';
          return path + o.message;
        }
      }
      return '';
    })
    .filter((t) => t.trim() !== '');
}

export function failureMessage(body: unknown): string {
  const b = (body ?? {}) as { error?: unknown; details?: unknown };
  const specific = detailStrings(b.details);
  const generic = typeof b.error === 'string' && b.error.trim() !== '' ? b.error : 'Generation failed';
  if (specific.length === 0) return generic;
  // Keep the label as a prefix so the class of failure is still visible, but
  // lead with what a person can act on.
  return `${generic}: ${specific.join(' · ')}`;
}

export function CplModal({ open, onClose, orderId, fileNumber, address, isClient, onSuccess }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
  onSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [underwriter, setUnderwriter] = useState<Underwriter>('westcor');
  const [branches, setBranches] = useState<CplBranch[]>([]);
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
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string; warnings?: string[] } | null>(null);

  const hasLender = !!(lenderCompany);
  const hasProperty = !!(propStreet);
  const txLower = txType.toLowerCase();
  const isPurchase = txLower === 'purchase';
  const isRefi = txLower === 'refinance' || txLower === 'equity';
  const [lenderExpanded, setLenderExpanded] = useState(true);
  const [propertyExpanded, setPropertyExpanded] = useState(true);

  // Load branches when underwriter changes
  useEffect(() => {
    if (!open) return;
    fetch(`/api/cpl-branches?underwriter=${underwriter}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const list: CplBranch[] = d?.branches ?? [];
        setBranches(list);
        if (list.length > 0 && !list.some((b) => b.id === branchId)) {
          setBranchId(null);
        }
      })
      .catch(() => setBranches([]));
  }, [open, underwriter]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setResult(null); setLenderType('new'); setTxType(''); setBranchId(null);
      setLenderCompany(''); setLenderContact(''); setAssignmentClause('');
      setLenderAddr(''); setLenderCity(''); setLenderState(''); setLenderZip('');
      setPropStreet(''); setPropCity(''); setPropState(''); setPropZip('');
      setLoanNumber(''); setLoanAmount(''); setSalesAmount(''); setBorrower('');
      setLenderExpanded(true); setPropertyExpanded(true);
    });
    const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;
    const docUrl = isClient ? `${base}/cpl` : `${base}/documents?category=cpl`;
    Promise.all([
      fetch(base, { signal: controller.signal }).then((r) => r.ok ? r.json() : null),
      fetch(docUrl, { signal: controller.signal }).then((r) => r.ok ? r.json() : { documents: [] }),
    ]).then(([od, docData]) => {
      if (docData?.documents) setExistingCpls(docData.documents);

      if (od) {
        const o = od as OrderApiResponse;
        const cpd = o.cplData ?? {};

        // Auto-detect underwriter from order data
        const detected = detectUnderwriter(o);
        setUnderwriter(detected);

        // Branch: prefer saved CPL branch, then order branch
        const savedBranch = cpd.cpl_branch_id ? Number(cpd.cpl_branch_id) : null;
        if (savedBranch) setBranchId(savedBranch);
        else if (o.branchId) setBranchId(o.branchId);

        setTxType(o.transactionType ?? '');
        setSalesAmount(o.salesPrice ?? '');
        setLoanAmount(o.loanAmount ?? '');
        setLoanNumber(cpd.cpl_loan_number ?? '');

        const prop = o.property;
        if (prop) {
          setPropStreet(prop.address ?? '');
          setPropCity(prop.city ?? '');
          setPropState(prop.state ?? '');
          setPropZip(prop.zip ?? '');
        }

        const lc = o.lenderContact;
        const lenderParty = o.parties?.find((p) => p.role === 'lender');
        setLenderCompany(lc?.companyName ?? lenderParty?.externalCompany ?? '');
        setLenderContact(cpd.cpl_lender_contact ?? lc?.fullName ?? lenderParty?.externalName ?? '');
        setLenderAddr(cpd.cpl_lender_address ?? lc?.address1 ?? '');
        setLenderCity(cpd.cpl_lender_city ?? lc?.city ?? '');
        setLenderState(cpd.cpl_lender_state ?? lc?.state ?? '');
        setLenderZip(cpd.cpl_lender_zip ?? lc?.zip ?? '');
        setAssignmentClause(cpd.cpl_assignment_clause ?? lc?.assignmentClause ?? '');

        const buyers = (o.parties ?? [])
          .filter((p) => p.role === 'buyer')
          .map((p) => p.externalName)
          .filter(Boolean)
          .join(', ');
        setBorrower(buyers);

        setLenderExpanded(!(lc?.companyName ?? lenderParty?.externalCompany));
        setPropertyExpanded(!prop?.address);
      }
    }).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }).finally(() => setLoading(false));
    return () => controller.abort();
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
    setLenderCompany(l.companyName ?? ''); setLenderAddr(l.address ?? '');
    setLenderCity(l.city ?? ''); setLenderState(l.state ?? ''); setLenderZip(l.zip ?? '');
    setLenderSearch(''); setLenderResults([]);
  }

  async function generate() {
    if (!branchId) return;
    if (!lenderCompany.trim()) { setResult({ ok: false, error: 'Lender company name is required to generate a CPL.' }); return; }
    if (!propStreet.trim()) { setResult({ ok: false, error: 'Property address is required to generate a CPL.' }); return; }
    setGenerating(true); setResult(null);
    try {
      const cplUrl = isClient ? `/api/client/orders/${orderId}/cpl` : '/api/vendor-actions/cpl';
      const cplBody = isClient ? { underwriter, branchId } : {
        orderId, underwriter, branchId, lenderCompany, lenderContact, assignmentClause,
        lenderAddress: lenderAddr, lenderCity, lenderState, lenderZip,
        propertyAddress: propStreet, propertyCity: propCity, propertyState: propState, propertyZip: propZip,
        loanNumber, loanAmount, salesAmount, borrowerNames: borrower,
      };
      const res = await fetch(cplUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cplBody) });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(failureMessage(body));
      // A CPL can succeed WITH complaints. Those must not read as a clean run:
      // the server returns them as `warnings` and this used to drop them.
      setResult({ ok: true, docId: body.documentId, warnings: detailStrings(body.warnings) });
      onSuccess?.();
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
          <Section label={txType ? `Transaction — ${txType}` : 'Transaction'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <F label="Loan Number" value={loanNumber} onChange={setLoanNumber} />
              {isRefi && <F label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />}
              {isPurchase && <F label="Sales Amount" value={salesAmount} onChange={setSalesAmount} prefix="$" />}
              {!isPurchase && !isRefi && (
                <>
                  <F label="Loan Amount" value={loanAmount} onChange={setLoanAmount} prefix="$" />
                  <F label="Sales Amount" value={salesAmount} onChange={setSalesAmount} prefix="$" />
                </>
              )}
              <F label="Primary Borrower / Vesting" value={borrower} onChange={setBorrower} className="sm:col-span-2" />
            </div>
          </Section>

          {/* ── Underwriter + Branch ── */}
          <Section label="Underwriter & Branch">
            <div className="space-y-3">
              <div className="flex gap-4">
                {(Object.keys(UNDERWRITER_LABELS) as Underwriter[]).map((uw) => (
                  <label key={uw} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="underwriter" checked={underwriter === uw}
                      onChange={() => { setUnderwriter(uw); setBranchId(null); }}
                      className="accent-[#F26B2B]" />
                    {UNDERWRITER_LABELS[uw]}
                  </label>
                ))}
              </div>
              <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
                className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
                <option value="">Select branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
              {branches.length === 0 && !loading && (
                <p className="text-[11px] text-amber-600">No branches configured for {UNDERWRITER_LABELS[underwriter]}. Contact admin.</p>
              )}
            </div>
          </Section>

          {/* ── Result ── */}
          {result && (
            <div className={`px-4 py-3 rounded-lg text-sm ${
              result.ok
                ? (result.warnings && result.warnings.length > 0
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-green-50 text-green-700 border border-green-200')
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {result.ok ? (
                <>
                  <span>CPL generated. <a href={`${isClient ? '/api/client' : '/api'}/documents/${result.docId}/download`} target="_blank" rel="noopener noreferrer" className="underline font-semibold text-[#F26B2B]">Download CPL</a></span>
                  {/* Succeeded, but the vendor complained. Amber, not green —
                      a CPL issued with warnings must not look like a clean run. */}
                  {result.warnings && result.warnings.length > 0 && (
                    <ul className="mt-2 list-disc pl-4 space-y-0.5">
                      {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </>
              ) : result.error}
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

          {/* ── Existing Documents ── */}
          {existingCpls.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Existing Documents</p>
              <div className="space-y-1.5">
                {existingCpls.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-sm text-[#1A1A2E] truncate">{d.filename ?? d.fileName ?? 'CPL.pdf'}</p>
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

function Collapse({ title, complete, summary, expanded, onToggle, children }: {
  title: string; complete: boolean; summary: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
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
