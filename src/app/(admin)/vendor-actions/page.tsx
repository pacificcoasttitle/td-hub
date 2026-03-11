'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderResult {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  property: { address: string | null; city: string | null; state: string | null } | null;
}

interface CplBranch {
  id: number;
  branchName: string | null;
  agencyName: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

type Underwriter = 'westcor' | 'fnf' | 'natic' | 'doma';
type TabKey = 'cpl' | 'titlepoint';
type WizardStep = 1 | 2 | 3 | 4 | 5;

// ─── Constants ──────────────────────────────────────────────────────────────

const UNDERWRITERS: { value: Underwriter; label: string; description: string }[] = [
  { value: 'westcor', label: 'Westcor', description: 'REST/JSON · OAuth2' },
  { value: 'fnf', label: 'FNF / Commonwealth', description: 'SOAP/XML · Two-tier JWT' },
  { value: 'natic', label: 'NATIC', description: 'XML/HTTP' },
  { value: 'doma', label: 'Doma', description: 'XML/HTTP' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VendorActionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'cpl';
  const prefilledOrderId = searchParams.get('orderId');

  function setTab(tab: TabKey) {
    router.push(`/vendor-actions?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Vendor Actions</h1>
        <p className="text-sm text-[#6B7280] mt-1">CPL generation and TitlePoint requests</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['cpl', 'CPL Generation'], ['titlepoint', 'TitlePoint']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {label}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'cpl' ? <CplWizard prefilledOrderId={prefilledOrderId} /> : <TitlePointWizard prefilledOrderId={prefilledOrderId} />}
    </div>
  );
}

// ─── CPL Wizard ─────────────────────────────────────────────────────────────

function CplWizard({ prefilledOrderId }: { prefilledOrderId: string | null }) {
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [underwriter, setUnderwriter] = useState<Underwriter | null>(null);
  const [branches, setBranches] = useState<CplBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<CplBranch | null>(null);
  const [lender, setLender] = useState({
    companyName: '', contactName: '', address: '', city: '', state: '', zip: '', assignmentClause: '',
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Pre-fill order from URL param
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

  // Load branches when underwriter changes
  useEffect(() => {
    if (!underwriter) { setBranches([]); setSelectedBranch(null); return; }
    fetch(`/api/vendor-actions/cpl/branches?underwriter=${underwriter}`)
      .then((r) => r.ok ? r.json() : { branches: [] })
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([]));
  }, [underwriter]);

  function handleSelectOrder(order: OrderResult) {
    setSelectedOrder(order);
    setStep(2);
  }

  function handleSelectUnderwriter(uw: Underwriter) {
    setUnderwriter(uw);
    setSelectedBranch(null);
    setStep(3);
  }

  function handleSelectBranch(branch: CplBranch) {
    setSelectedBranch(branch);
    setStep(4);
  }

  function handleProceedToGenerate() {
    setStep(5);
  }

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
          orderId: selectedOrder.id,
          underwriter,
          branchId: selectedBranch.id,
          cplMode: 'single',
          ...(hasOverrides ? { lenderOverrides: lender } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }

      setResult({ type: 'success', message: 'CPL generated successfully.' });
    } catch (err) {
      setResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'CPL generation failed',
      });
    } finally {
      setGenerating(false);
    }
  }

  function handleReset() {
    setStep(1);
    setSelectedOrder(null);
    setUnderwriter(null);
    setSelectedBranch(null);
    setBranches([]);
    setLender({ companyName: '', contactName: '', address: '', city: '', state: '', zip: '', assignmentClause: '' });
    setResult(null);
  }

  const steps = [
    { n: 1, label: 'Order' },
    { n: 2, label: 'Underwriter' },
    { n: 3, label: 'Branch' },
    { n: 4, label: 'Lender Info' },
    { n: 5, label: 'Generate' },
  ];

  return (
    <div className="max-w-3xl">
      {/* Progress */}
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

      {/* Step content */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {step === 1 && <StepSelectOrder onSelect={handleSelectOrder} />}
        {step === 2 && (
          <StepSelectUnderwriter
            order={selectedOrder!}
            selected={underwriter}
            onSelect={handleSelectUnderwriter}
          />
        )}
        {step === 3 && (
          <StepSelectBranch
            underwriter={underwriter!}
            branches={branches}
            selected={selectedBranch}
            onSelect={handleSelectBranch}
          />
        )}
        {step === 4 && (
          <StepLenderInfo lender={lender} setLender={setLender} onProceed={handleProceedToGenerate} />
        )}
        {step === 5 && (
          <StepGenerate
            order={selectedOrder!}
            underwriter={underwriter!}
            branch={selectedBranch!}
            generating={generating}
            result={result}
            onGenerate={handleGenerate}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}

// ─── Step 1: Select Order ───────────────────────────────────────────────────

function StepSelectOrder({ onSelect }: { onSelect: (o: OrderResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/orders?search=${encodeURIComponent(q)}&pageSize=8`)
      .then((r) => r.ok ? r.json() : { orders: [] })
      .then((d) => setResults(d.orders ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1">Select Order</h3>
      <p className="text-sm text-[#6B7280] mb-4">Search by file number or property address</p>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="File number or address…"
          autoFocus
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
        />
      </div>

      {loading && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="mt-3 space-y-1">
          {results.map((o) => {
            const addr = [o.property?.address, o.property?.city, o.property?.state].filter(Boolean).join(', ');
            return (
              <li key={o.id}>
                <button
                  onClick={() => onSelect(o)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-[#C5A55A] hover:bg-[#C5A55A]/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#1A1A2E]">{o.fileNumber}</span>
                    <StatusBadge status={o.operationalStatus} />
                  </div>
                  {addr && <p className="text-sm text-[#6B7280] mt-0.5">{addr}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="mt-4 text-center text-sm text-[#6B7280]">No orders found for &quot;{query}&quot;</p>
      )}
    </div>
  );
}

// ─── Step 2: Select Underwriter ─────────────────────────────────────────────

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
              selected === uw.value
                ? 'border-[#C5A55A] bg-[#C5A55A]/5'
                : 'border-gray-200 hover:border-[#1B2A4A]/30'
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

// ─── Step 3: Select Branch ──────────────────────────────────────────────────

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
                selected?.id === b.id
                  ? 'border-[#C5A55A] bg-[#C5A55A]/5'
                  : 'border-gray-200 hover:border-[#1B2A4A]/30'
              }`}
            >
              <p className="font-medium text-[#1A1A2E]">{b.branchName ?? b.agencyName ?? 'Branch'}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {[b.city, b.state].filter(Boolean).join(', ') || 'No location'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Lender Info ────────────────────────────────────────────────────

interface LenderInfo {
  companyName: string;
  contactName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  assignmentClause: string;
}

function StepLenderInfo({
  lender, setLender, onProceed,
}: {
  lender: LenderInfo;
  setLender: (l: LenderInfo) => void;
  onProceed: () => void;
}) {
  function update(field: keyof LenderInfo, value: string) {
    setLender({ ...lender, [field]: value });
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1">Lender Information</h3>
      <p className="text-sm text-[#6B7280] mb-4">
        Override lender details if needed. Leave blank to use data from the order.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Company Name" value={lender.companyName} onChange={(v) => update('companyName', v)} placeholder="Auto from order" />
        <FormField label="Contact Name" value={lender.contactName} onChange={(v) => update('contactName', v)} placeholder="Auto from order" />
        <FormField label="Address" value={lender.address} onChange={(v) => update('address', v)} placeholder="Auto from order" />
        <FormField label="City" value={lender.city} onChange={(v) => update('city', v)} placeholder="Auto from order" />
        <FormField label="State" value={lender.state} onChange={(v) => update('state', v)} placeholder="CA" />
        <FormField label="ZIP" value={lender.zip} onChange={(v) => update('zip', v)} placeholder="Auto from order" />
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Assignment Clause</label>
          <textarea
            value={lender.assignmentClause}
            onChange={(e) => update('assignmentClause', e.target.value)}
            placeholder="Optional — auto from order if available"
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white resize-none"
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={onProceed}
          className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
        >
          Continue to Generate
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: Generate ───────────────────────────────────────────────────────

function StepGenerate({
  order, underwriter, branch, generating, result, onGenerate, onReset,
}: {
  order: OrderResult;
  underwriter: Underwriter;
  branch: CplBranch;
  generating: boolean;
  result: { type: 'success' | 'error'; message: string } | null;
  onGenerate: () => void;
  onReset: () => void;
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
          result.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <p className="font-medium">{result.message}</p>
          {result.type === 'success' && (
            <Link
              href={`/orders/${order.id}?tab=Documents`}
              className="text-green-800 underline text-xs mt-1 inline-block"
            >
              View in Documents tab →
            </Link>
          )}
          {result.type === 'error' && (
            <p className="text-xs mt-1">
              We are aware of the error and our customer service team will be contacting you shortly.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {!result?.type || result.type === 'error' ? (
          <button
            onClick={onGenerate}
            disabled={generating}
            className="px-5 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {generating && (
              <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {generating ? 'Generating CPL…' : 'Generate CPL'}
          </button>
        ) : null}

        <button
          onClick={onReset}
          className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors"
        >
          {result?.type === 'success' ? 'Generate Another' : 'Start Over'}
        </button>
      </div>
    </div>
  );
}

// ─── TitlePoint Wizard ──────────────────────────────────────────────────────

type TpSearchType = 'geo_address' | 'legal_vesting' | 'grant_deed' | 'tax';
type TpStep = 'order' | 'type' | 'initiate' | 'status';

interface TpRequest {
  id: number;
  status: string | null;
  searchType: string | null;
  message: string | null;
  requestId: string | null;
  createdAt: string;
}

const SEARCH_TYPES: { value: TpSearchType; label: string; description: string }[] = [
  { value: 'geo_address', label: 'Property Search', description: 'Geo/Address — search by property address' },
  { value: 'legal_vesting', label: 'Legal Vesting', description: 'Legal vesting document retrieval' },
  { value: 'grant_deed', label: 'Grant Deed', description: 'Deed image by instrument number' },
  { value: 'tax', label: 'Tax', description: 'Tax document retrieval' },
];

function TitlePointWizard({ prefilledOrderId }: { prefilledOrderId: string | null }) {
  const [tpStep, setTpStep] = useState<TpStep>('order');
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [searchType, setSearchType] = useState<TpSearchType | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [tpRequest, setTpRequest] = useState<TpRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!prefilledOrderId) return;
    fetch(`/api/orders/${prefilledOrderId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((order) => {
        if (order) {
          setSelectedOrder({ id: order.id, fileNumber: order.fileNumber, operationalStatus: order.operationalStatus, property: order.property });
          setTpStep('type');
        }
      })
      .catch(() => {});
  }, [prefilledOrderId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function handleSelectOrder(order: OrderResult) {
    setSelectedOrder(order);
    setTpStep('type');
  }

  function handleSelectSearchType(st: TpSearchType) {
    setSearchType(st);
    setTpStep('initiate');
  }

  async function handleInitiate() {
    if (!selectedOrder || !searchType) return;
    setInitiating(true);
    setError(null);

    try {
      const res = await fetch('/api/vendor-actions/titlepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selectedOrder.id, searchType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setTpRequest(data.request);
      setTpStep('status');
      startPolling(data.request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate search');
    } finally {
      setInitiating(false);
    }
  }

  function startPolling(requestId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/vendor-actions/titlepoint/${requestId}`);
        if (!res.ok) return;
        const data = await res.json();
        setTpRequest(data.request);
        if (data.request.status !== 'pending') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setTpStep('order');
    setSelectedOrder(null);
    setSearchType(null);
    setTpRequest(null);
    setError(null);
  }

  const tpSteps = [
    { key: 'order', label: 'Order' },
    { key: 'type', label: 'Search Type' },
    { key: 'initiate', label: 'Initiate' },
  ];
  const stepIdx = tpStep === 'status' ? 3 : tpSteps.findIndex((s) => s.key === tpStep);

  return (
    <div className="max-w-3xl">
      {/* Progress */}
      <div className="flex items-center gap-1 mb-8">
        {tpSteps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <button
              onClick={() => { if (i < stepIdx) setTpStep(s.key as TpStep); }}
              disabled={i > stepIdx}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === stepIdx
                  ? 'bg-[#1B2A4A] text-white'
                  : i < stepIdx
                    ? 'bg-[#C5A55A]/20 text-[#1B2A4A] hover:bg-[#C5A55A]/30 cursor-pointer'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                i < stepIdx ? 'bg-[#C5A55A] text-white' : i === stepIdx ? 'bg-white/20' : ''
              }`}>
                {i < stepIdx ? '✓' : i + 1}
              </span>
              {s.label}
            </button>
            {i < tpSteps.length - 1 && <div className="w-4 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {tpStep === 'order' && <StepSelectOrder onSelect={handleSelectOrder} />}

        {tpStep === 'type' && selectedOrder && (
          <div className="p-6">
            <OrderSummaryBanner order={selectedOrder} />
            <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1 mt-5">Search Type</h3>
            <p className="text-sm text-[#6B7280] mb-4">Select the type of TitlePoint search to perform</p>
            <div className="grid grid-cols-2 gap-3">
              {SEARCH_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => handleSelectSearchType(st.value)}
                  className={`text-left px-4 py-4 rounded-lg border-2 transition-colors ${
                    searchType === st.value
                      ? 'border-[#C5A55A] bg-[#C5A55A]/5'
                      : 'border-gray-200 hover:border-[#1B2A4A]/30'
                  }`}
                >
                  <p className="font-semibold text-[#1A1A2E]">{st.label}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{st.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {tpStep === 'initiate' && selectedOrder && searchType && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Confirm &amp; Start</h3>
            <div className="grid grid-cols-2 gap-4 text-sm mb-6">
              <SummaryField
                label="Order"
                value={selectedOrder.fileNumber}
                sub={[selectedOrder.property?.address, selectedOrder.property?.city].filter(Boolean).join(', ') || undefined}
              />
              <SummaryField
                label="Search Type"
                value={SEARCH_TYPES.find((s) => s.value === searchType)?.label ?? searchType}
              />
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <p className="font-medium">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleInitiate}
                disabled={initiating}
                className="px-5 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                {initiating && (
                  <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {initiating ? 'Starting…' : 'Start Search'}
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {tpStep === 'status' && tpRequest && (
          <TpStatusCard
            request={tpRequest}
            orderId={selectedOrder!.id}
            onReset={handleReset}
            onRetry={handleInitiate}
          />
        )}
      </div>
    </div>
  );
}

function TpStatusCard({
  request, orderId, onReset, onRetry,
}: {
  request: TpRequest; orderId: number; onReset: () => void; onRetry: () => void;
}) {
  const isPending = request.status === 'pending';
  const isSuccess = request.status === 'Success' || request.status === 'completed';
  const isFailed = !isPending && !isSuccess;
  const stLabel = SEARCH_TYPES.find((s) => s.value === request.searchType)?.label ?? request.searchType;

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Search Status</h3>

      <div className={`px-5 py-4 rounded-lg border ${
        isPending ? 'bg-amber-50 border-amber-200' : isSuccess ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-start gap-3">
          {isPending && (
            <svg className="h-5 w-5 text-amber-500 animate-spin shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {isSuccess && (
            <svg className="h-5 w-5 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isFailed && (
            <svg className="h-5 w-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <div className="flex-1">
            <p className={`font-medium text-sm ${isPending ? 'text-amber-800' : isSuccess ? 'text-green-800' : 'text-red-800'}`}>
              {isPending ? 'Searching…' : isSuccess ? 'Results ready' : 'Search failed'}
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              {stLabel}{request.message ? ` — ${request.message}` : ''}
            </p>
            {isPending && (
              <p className="text-xs text-amber-600 mt-2">Polling for results every 5 seconds…</p>
            )}
            {isSuccess && (
              <Link
                href={`/orders/${orderId}?tab=Documents`}
                className="text-xs text-green-800 underline mt-2 inline-block"
              >
                View documents →
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        {isFailed && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
          >
            Retry
          </button>
        )}
        <button
          onClick={onReset}
          className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors"
        >
          New Search
        </button>
      </div>
    </div>
  );
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function OrderSummaryBanner({ order }: { order: OrderResult }) {
  const addr = [order.property?.address, order.property?.city, order.property?.state].filter(Boolean).join(', ');
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
      <div>
        <p className="font-medium text-[#1A1A2E] text-sm">{order.fileNumber}</p>
        {addr && <p className="text-xs text-[#6B7280]">{addr}</p>}
      </div>
      <StatusBadge status={order.operationalStatus} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function FormField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#6B7280] mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
      />
    </div>
  );
}

function SummaryField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3 bg-gray-50 rounded-lg">
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="font-medium text-[#1A1A2E] mt-0.5">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-0.5">{sub}</p>}
    </div>
  );
}
