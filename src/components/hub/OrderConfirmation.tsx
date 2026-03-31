'use client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaxInstallment {
  balance?: string; amount?: string; dueDate?: string; number?: string;
  paymentDate?: string; penalty?: string; status?: string; amountPaid?: string; taxYear?: string;
}

export interface DocStatus {
  status: 'ready' | 'processing' | 'not_available';
  url?: string | null;
  label: string;
}

export interface PartyInfo {
  name?: string; email?: string; phone?: string; company?: string;
}

interface TpDocEntry { status: string; s3Url?: string | null }

export interface ConfirmationData {
  order: { fileNumber: string; createdAt: string };
  opener?: PartyInfo;
  property?: { address?: string; city?: string; zip?: string; county?: string; apn?: string; legalDescription?: string };
  titlePoint?: {
    legalDescription?: string | null;
    vestingInformation?: string | null;
    taxRateArea?: string | null;
    useCode?: string | null;
    landValue?: string | null;
    improvementsValue?: string | null;
    taxRate?: string | null;
    issueDate?: string | null;
    firstInstallment?: TaxInstallment | null;
    secondInstallment?: TaxInstallment | null;
    documents?: { lv?: TpDocEntry; grantDeed?: TpDocEntry; tax?: TpDocEntry };
  };
  transaction?: { salesRep?: string; titleOfficer?: string; productType?: string; salesPrice?: number; loanAmount?: number };
  seller?: { primaryOwner?: string; secondaryOwner?: string | null };
  parties?: { buyerAgent?: PartyInfo | null; listingAgent?: PartyInfo | null; lender?: PartyInfo | null; escrow?: PartyInfo | null };
}

function mapDocStatus(entry: TpDocEntry | undefined, label: string): DocStatus {
  if (!entry || entry.status === 'not_started' || entry.status === 'failed')
    return { status: 'not_available', url: null, label };
  if (entry.status === 'pending' || entry.status === 'processing')
    return { status: 'processing', url: null, label };
  return { status: 'ready', url: entry.s3Url ?? null, label };
}

export function hasProcessingDocs(data: ConfirmationData): boolean {
  const d = data.titlePoint?.documents;
  if (!d) return false;
  return [d.lv, d.grantDeed, d.tax].some(
    (e) => e?.status === 'pending' || e?.status === 'processing',
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CARD = 'bg-white border border-gray-200 shadow-sm rounded-lg p-6';
const H2 = 'text-lg font-semibold text-[#1B2A4A] mb-4';
const LBL = 'text-xs font-medium text-[#6B7280] uppercase tracking-wider';
const VAL = 'text-sm text-[#1A1A2E]';
const DASH = '—';
const SEP = 'border-b border-gray-200 pb-6 mb-6';

function F({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className={LBL}>{label}</p>
      <p className={VAL}>{value ?? DASH}</p>
    </div>
  );
}

// ─── Section 2: Order Details ───────────────────────────────────────────────

function OrderDetailsSection({ data }: { data: ConfirmationData }) {
  const tp = data.titlePoint;
  return (
    <div className={SEP}>
      <div className={CARD}>
        <h2 className={H2}>Order Details</h2>
        <p className="text-2xl font-bold text-[#1B2A4A] mb-1">{data.order.fileNumber}</p>
        <p className="text-xs text-[#6B7280] mb-6">Created {data.order.createdAt}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <F label="Brief Legal Description" value={tp?.legalDescription || 'Refer to grant deed below.'} />
          <F label="Vesting Information" value={tp?.vestingInformation || 'Refer to grant deed below.'} />
        </div>
        {data.opener && (
          <div className="border-t border-gray-100 mt-5 pt-4 space-y-1">
            <p className={LBL}>Opened By</p>
            <p className={VAL}>{data.opener.name ?? DASH}</p>
            <p className="text-xs text-[#6B7280]">{[data.opener.email, data.opener.phone, data.opener.company].filter(Boolean).join(' · ') || DASH}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 3: Vesting & Tax Information ───────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  unpaid: 'bg-amber-100 text-amber-800',
  delinquent: 'bg-red-100 text-red-800',
};

function statusBadge(s?: string) {
  if (!s) return null;
  const key = s.toLowerCase();
  const cls = STATUS_STYLE[key] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${cls}`}>{s}</span>;
}

function InstallmentCard({ title, inst }: { title: string; inst?: TaxInstallment | null }) {
  if (!inst) return (
    <div className="border border-gray-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-[#1A1A2E] mb-2">{title}</p>
      <p className="text-xs text-[#9CA3AF] italic">No data found.</p>
    </div>
  );
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-[#1A1A2E] mb-3">{title}</p>
      <div className="space-y-2">
        <div className="flex justify-between text-xs"><span className="text-[#6B7280]">Amount</span><span className="text-[#1A1A2E] font-medium">{inst.amount ?? DASH}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#6B7280]">Balance</span><span className="text-[#1A1A2E] font-medium">{inst.balance ?? DASH}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#6B7280]">Due Date</span><span className="text-[#1A1A2E] font-medium">{inst.dueDate ?? DASH}</span></div>
        <div className="flex justify-between text-xs items-center"><span className="text-[#6B7280]">Status</span>{statusBadge(inst.status) ?? <span className="text-[#1A1A2E] font-medium">{DASH}</span>}</div>
      </div>
    </div>
  );
}

function VestingTaxSection({ data }: { data: ConfirmationData }) {
  const tp = data.titlePoint;
  const hasTax = tp?.taxRateArea || tp?.useCode || tp?.landValue || tp?.improvementsValue || tp?.taxRate || tp?.issueDate;
  const hasInstallments = tp?.firstInstallment || tp?.secondInstallment;

  if (!hasTax && !hasInstallments) {
    return (
      <div className={SEP}>
        <h2 className={H2}>Vesting &amp; Tax Information</h2>
        <div className={CARD}>
          <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
            <svg className="w-4 h-4 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Tax information pending — TitlePoint search in progress
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={SEP}>
      <h2 className={H2}>Vesting &amp; Tax Information</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Property Tax Summary */}
        <div className={CARD}>
          <p className="text-sm font-semibold text-[#1A1A2E] mb-4">Property Tax Summary</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <F label="Tax Rate Area" value={tp?.taxRateArea} />
            <F label="Use Code" value={tp?.useCode} />
            <F label="Land Value" value={tp?.landValue} />
            <F label="Improvements Value" value={tp?.improvementsValue} />
            <F label="Tax Rate" value={tp?.taxRate} />
            <F label="Issue Date" value={tp?.issueDate} />
          </div>
        </div>

        {/* Right: Installments */}
        <div className="space-y-4">
          <InstallmentCard title="1st Installment" inst={tp?.firstInstallment} />
          <InstallmentCard title="2nd Installment" inst={tp?.secondInstallment} />
        </div>
      </div>
    </div>
  );
}

// ─── Section 4: Title Documents ─────────────────────────────────────────────

function DocCard({ doc }: { doc: DocStatus }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 flex flex-col items-center text-center gap-2">
      <p className="text-sm font-semibold text-[#1A1A2E]">{doc.label}</p>
      {doc.status === 'ready' && (
        <>
          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-green-100 text-green-800">Ready</span>
          <button
            onClick={() => window.open(doc.url ?? '#', '_blank')}
            className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 bg-[#1B2A4A] text-white text-xs font-medium rounded-lg hover:bg-[#162240] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download
          </button>
        </>
      )}
      {doc.status === 'processing' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-amber-100 text-amber-800">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Processing...
        </span>
      )}
      {doc.status === 'not_available' && (
        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-gray-100 text-gray-500">Not available</span>
      )}
    </div>
  );
}

function TitleDocumentsSection({ data }: { data: ConfirmationData }) {
  const raw = data.titlePoint?.documents;
  const docs: DocStatus[] = [
    mapDocStatus(raw?.lv, 'Legal & Vesting'),
    mapDocStatus(raw?.tax, 'Tax Report'),
    mapDocStatus(raw?.grantDeed, 'Grant Deed'),
  ];

  return (
    <div>
      <h2 className={H2}>Title Documents</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {docs.map((d) => <DocCard key={d.label} doc={d} />)}
      </div>
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (w: string) => <div className={`h-4 bg-gray-100 rounded animate-pulse ${w}`} />;
  return (
    <div className="space-y-6">
      <div className={CARD}>{bar('w-48 mb-4')}{bar('w-32 mb-6')}{bar('w-full mb-2')}{bar('w-3/4')}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={CARD}>{bar('w-40 mb-4')}<div className="grid grid-cols-2 gap-4">{bar('w-full h-6')}{bar('w-full h-6')}{bar('w-full h-6')}{bar('w-full h-6')}</div></div>
        <div className="space-y-4"><div className={CARD}>{bar('w-full h-24')}</div><div className={CARD}>{bar('w-full h-24')}</div></div>
      </div>
      <div className="grid grid-cols-3 gap-4"><div className={CARD}>{bar('w-full h-16')}</div><div className={CARD}>{bar('w-full h-16')}</div><div className={CARD}>{bar('w-full h-16')}</div></div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OrderConfirmation({ data, loading, error }: { data: ConfirmationData | null; loading: boolean; error: string | null }) {
  if (loading) return <Skeleton />;
  if (error) return <div className={CARD}><p className="text-sm text-red-600">{error}</p></div>;
  if (!data) return <div className={CARD}><p className="text-sm text-[#9CA3AF]">No confirmation data found.</p></div>;

  return (
    <div>
      {/* Section 1: Success Banner */}
      <div className={SEP}>
        <div className="flex items-center gap-3 px-5 py-4 bg-green-50 border border-green-200 rounded-lg">
          <svg className="h-5 w-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <div>
            <p className="text-sm font-semibold text-green-800">Order Created Successfully</p>
            <p className="text-xs text-green-700">File {data.order.fileNumber} has been submitted and is being processed.</p>
          </div>
        </div>
      </div>

      {/* Section 2: Order Details */}
      <OrderDetailsSection data={data} />

      {/* Section 3: Vesting & Tax Information */}
      <VestingTaxSection data={data} />

      {/* Section 4: Title Documents */}
      <TitleDocumentsSection data={data} />
    </div>
  );
}
