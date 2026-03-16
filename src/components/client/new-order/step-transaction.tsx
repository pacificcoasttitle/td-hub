'use client';

import { IN, SEL, UNDERWRITERS } from './types';
import { SH, FL, Nav, CurrInput } from './shared';

export function StepTransaction({ data, onChange, onNext, onPrev }: { data: any; onChange: (d: any) => void; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Transaction" sub="Financial and transaction details." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div><FL>Transaction Type</FL><select value={data.transactionType} onChange={(e) => onChange({ ...data, transactionType: e.target.value })} className={SEL}><option value="">Select…</option><option value="Purchase">Purchase</option><option value="Refinance">Refinance</option><option value="Equity">Equity</option><option value="Other">Other</option></select></div>
        <div><FL>Product Type</FL><input className={IN} value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} placeholder="Standard, Commercial…" /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div><FL>Escrow Number</FL><input className={IN} value={data.escrowNumber} onChange={(e) => onChange({ ...data, escrowNumber: e.target.value })} placeholder="Optional" /></div>
        <div><FL>Underwriter</FL><select value={data.underwriter} onChange={(e) => onChange({ ...data, underwriter: e.target.value })} className={SEL}>{UNDERWRITERS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></div>
      </div>
      {data.transactionType === 'Purchase' && <div className="mb-4"><FL>Sales Amount</FL><CurrInput value={data.salesAmount} onChange={(v) => onChange({ ...data, salesAmount: v })} /></div>}
      {data.transactionType === 'Refinance' && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div><FL>Loan Number</FL><input className={IN} value={data.loanNumber} onChange={(e) => onChange({ ...data, loanNumber: e.target.value })} /></div>
          <div><FL>Loan Amount</FL><CurrInput value={data.loanAmount} onChange={(v) => onChange({ ...data, loanAmount: v })} /></div>
        </div>
      )}
      <div><FL>Coverage Amount</FL><CurrInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} /></div>
      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.transactionType} />
    </div>
  );
}
