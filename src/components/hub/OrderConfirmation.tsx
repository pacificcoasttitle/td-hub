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

export interface ConfirmationData {
  order: { fileNumber: string; createdAt: string };
  opener?: PartyInfo;
  property?: { address?: string; city?: string; zip?: string; county?: string; apn?: string; legalDescription?: string };
  tax?: { firstInstallment?: TaxInstallment | null; secondInstallment?: TaxInstallment | null };
  vesting?: { briefLegal?: string | null; vestingInfo?: string | null };
  documents?: { lv?: DocStatus; grantDeed?: DocStatus; tax?: DocStatus };
  transaction?: { salesRep?: string; titleOfficer?: string; productType?: string; salesPrice?: number; loanAmount?: number; loanNumber?: string; escrowNumber?: string };
  seller?: { primaryOwner?: string; secondaryOwner?: string | null };
  parties?: { buyerAgent?: PartyInfo | null; listingAgent?: PartyInfo | null; lender?: PartyInfo | null; escrow?: PartyInfo | null };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CARD = 'bg-white border border-gray-200 shadow-sm rounded-lg p-6';
const H2 = 'text-lg font-semibold text-[#1A1A2E] mb-4';
const LBL = 'text-xs font-medium text-[#6B7280] uppercase tracking-wider';
const VAL = 'text-sm text-[#1A1A2E]';
const DASH = '—';

function V({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className={LBL}>{label}</p>
      <p className={VAL}>{value ?? DASH}</p>
    </div>
  );
}

// ─── Order Details Card (Left) ──────────────────────────────────────────────

function OrderDetailsCard({ data }: { data: ConfirmationData }) {
  const v = data.vesting;
  return (
    <div className={CARD}>
      <h2 className={H2}>Order Details</h2>
      <p className="text-2xl font-bold text-[#1B2A4A] mb-4">{data.order.fileNumber}</p>
      <p className="text-xs text-[#6B7280] mb-6">Created {data.order.createdAt}</p>
      <div className="space-y-4">
        <V label="Brief Legal Description" value={v?.briefLegal || 'Refer to grant deed below.'} />
        <V label="Vesting Information" value={v?.vestingInfo || 'Refer to grant deed below.'} />
      </div>
      {data.opener && (
        <div className="border-t border-gray-100 mt-5 pt-4 space-y-2">
          <p className={LBL}>Opened By</p>
          <p className={VAL}>{data.opener.name ?? DASH}</p>
          <p className="text-xs text-[#6B7280]">{[data.opener.email, data.opener.phone, data.opener.company].filter(Boolean).join(' · ') || DASH}</p>
        </div>
      )}
    </div>
  );
}

// ─── Tax Information Card (Right) ───────────────────────────────────────────

const TAX_FIELDS: { label: string; key: keyof TaxInstallment }[] = [
  { label: 'Balance', key: 'balance' }, { label: 'Amount', key: 'amount' },
  { label: 'Due Date', key: 'dueDate' }, { label: 'Number', key: 'number' },
  { label: 'Payment Date', key: 'paymentDate' }, { label: 'Penalty', key: 'penalty' },
  { label: 'Status', key: 'status' }, { label: 'Amount Paid', key: 'amountPaid' },
  { label: 'Tax Year', key: 'taxYear' },
];

function InstallmentCard({ title, inst }: { title: string; inst?: TaxInstallment | null }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-[#1A1A2E] mb-3">{title}</p>
      {inst ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {TAX_FIELDS.map((f) => (
            <div key={f.key}><p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{f.label}</p><p className="text-xs text-[#1A1A2E]">{inst[f.key] ?? DASH}</p></div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#9CA3AF] italic">No data found.</p>
      )}
    </div>
  );
}

function TaxInfoCard({ data }: { data: ConfirmationData }) {
  return (
    <div className={CARD}>
      <h2 className={H2}>Tax Information</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InstallmentCard title="1st Installment" inst={data.tax?.firstInstallment} />
        <InstallmentCard title="2nd Installment" inst={data.tax?.secondInstallment} />
      </div>
    </div>
  );
}

// ─── Document Status Section ────────────────────────────────────────────────

function DocColumn({ doc, fallbackMsg }: { doc?: DocStatus; fallbackMsg: string }) {
  if (!doc || doc.status === 'not_available') {
    return <p className="text-sm text-[#9CA3AF]">{fallbackMsg}</p>;
  }
  if (doc.status === 'processing') {
    return (
      <div>
        <p className="text-sm text-amber-600 flex items-center gap-1.5">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Document generation is under processing
        </p>
        <button className="mt-2 text-xs font-medium text-[#1B2A4A] underline underline-offset-2 hover:text-[#F26B2B]">Check Status</button>
      </div>
    );
  }
  return (
    <a href={doc.url ?? '#'} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1B2A4A] text-white text-sm font-medium rounded-lg hover:bg-[#162240] transition-colors">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
      Download {doc.label}
    </a>
  );
}

function DocumentStatusSection({ data }: { data: ConfirmationData }) {
  const d = data.documents;
  return (
    <div className={CARD}>
      <h2 className={H2}>Grant Deed Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <p className={`${LBL} mb-2`}>Legal &amp; Vesting</p>
          <DocColumn doc={d?.lv} fallbackMsg="No legal vesting available. Our team will look for it and contact you shortly." />
        </div>
        <div>
          <p className={`${LBL} mb-2`}>Grant Deed</p>
          <DocColumn doc={d?.grantDeed} fallbackMsg="No grant deed available. Our team will look for it and contact you shortly." />
        </div>
        <div>
          <p className={`${LBL} mb-2`}>Tax Document</p>
          <DocColumn doc={d?.tax} fallbackMsg="No tax document available. Our team will look for it and contact you shortly." />
        </div>
      </div>
    </div>
  );
}

// ─── Action Cards ───────────────────────────────────────────────────────────

function ActionCards({ fileNumber }: { fileNumber: string }) {
  const actions = [
    { label: 'Generate CPL', desc: 'Create a Closing Protection Letter', href: `/hub?action=cpl&file=${fileNumber}`, accent: true },
    { label: 'Proposed Insured', desc: 'Generate proposed insured document', href: `/hub?action=proposed&file=${fileNumber}`, accent: false },
    { label: 'Open New Order', desc: 'Start another order', href: '/hub/new-order', accent: false },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {actions.map((a) => (
        <a key={a.label} href={a.href}
          className={`${CARD} flex flex-col items-start hover:shadow-md transition-shadow`}>
          <p className={`text-sm font-semibold ${a.accent ? 'text-[#F26B2B]' : 'text-[#1B2A4A]'}`}>{a.label}</p>
          <p className="text-xs text-[#6B7280] mt-1">{a.desc}</p>
          <span className={`mt-3 text-xs font-medium ${a.accent ? 'text-[#F26B2B]' : 'text-[#1B2A4A]'}`}>Go →</span>
        </a>
      ))}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (w: string) => <div className={`h-4 bg-gray-100 rounded animate-pulse ${w}`} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={CARD}>{bar('w-48 mb-4')}{bar('w-32 mb-6')}{bar('w-full mb-2')}{bar('w-3/4')}</div>
        <div className={CARD}>{bar('w-40 mb-4')}<div className="grid grid-cols-2 gap-4"><div>{bar('w-full h-40')}</div><div>{bar('w-full h-40')}</div></div></div>
      </div>
      <div className={CARD}>{bar('w-48 mb-4')}<div className="grid grid-cols-3 gap-6"><div>{bar('w-full h-20')}</div><div>{bar('w-full h-20')}</div><div>{bar('w-full h-20')}</div></div></div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OrderConfirmation({ data, loading, error }: { data: ConfirmationData | null; loading: boolean; error: string | null }) {
  if (loading) return <Skeleton />;
  if (error) return <div className={CARD}><p className="text-sm text-red-600">{error}</p></div>;
  if (!data) return <div className={CARD}><p className="text-sm text-[#9CA3AF]">No confirmation data found.</p></div>;

  return (
    <div className="space-y-6">
      {/* Success banner */}
      <div className="flex items-center gap-3 px-5 py-4 bg-green-50 border border-green-200 rounded-lg">
        <svg className="h-5 w-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <div>
          <p className="text-sm font-semibold text-green-800">Order Created Successfully</p>
          <p className="text-xs text-green-700">File {data.order.fileNumber} has been submitted and is being processed.</p>
        </div>
      </div>

      {/* Two-column: Order Details + Tax Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrderDetailsCard data={data} />
        <TaxInfoCard data={data} />
      </div>

      {/* Full-width: Documents */}
      <DocumentStatusSection data={data} />

      {/* Action Cards */}
      <ActionCards fileNumber={data.order.fileNumber} />
    </div>
  );
}
