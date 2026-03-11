import type { TransactionData } from './types';
import { INPUT_CLASS, SELECT_CLASS, UNDERWRITERS } from './constants';
import { FieldLabel, StepHeader, StepNav } from './shared';

export function Step4Transaction({
  data, onChange, onNext, onPrev,
}: {
  data: TransactionData; onChange: (d: TransactionData) => void; onNext: () => void; onPrev: () => void;
}) {
  const isPurchase = data.transactionType === 'Purchase';
  const isRefi = data.transactionType === 'Refinance';

  return (
    <div className="p-6">
      <StepHeader title="Transaction" sub="Transaction details and financial information." />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Transaction Type</FieldLabel>
          <select
            value={data.transactionType}
            onChange={(e) => onChange({ ...data, transactionType: e.target.value as TransactionData['transactionType'] })}
            className={SELECT_CLASS}
          >
            <option value="">Select type…</option>
            <option value="Purchase">Purchase</option>
            <option value="Refinance">Refinance</option>
            <option value="Equity">Equity</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <FieldLabel>Product Type</FieldLabel>
          <input className={INPUT_CLASS} value={data.productType} onChange={(e) => onChange({ ...data, productType: e.target.value })} placeholder="e.g. Standard, Commercial" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Escrow Number</FieldLabel>
          <input className={INPUT_CLASS} value={data.escrowNumber} onChange={(e) => onChange({ ...data, escrowNumber: e.target.value })} placeholder="Optional" />
        </div>
        <div>
          <FieldLabel>Underwriter</FieldLabel>
          <select value={data.underwriter} onChange={(e) => onChange({ ...data, underwriter: e.target.value })} className={SELECT_CLASS}>
            {UNDERWRITERS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      {isPurchase && (
        <div className="mb-6">
          <FieldLabel>Sales Amount</FieldLabel>
          <CurrencyInput value={data.salesAmount} onChange={(v) => onChange({ ...data, salesAmount: v })} />
        </div>
      )}

      {isRefi && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <FieldLabel>Loan Number</FieldLabel>
            <input className={INPUT_CLASS} value={data.loanNumber} onChange={(e) => onChange({ ...data, loanNumber: e.target.value })} placeholder="Loan #" />
          </div>
          <div>
            <FieldLabel>Loan Amount</FieldLabel>
            <CurrencyInput value={data.loanAmount} onChange={(v) => onChange({ ...data, loanAmount: v })} />
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Coverage Amount</FieldLabel>
        <CurrencyInput value={data.coverageAmount} onChange={(v) => onChange({ ...data, coverageAmount: v })} />
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} nextDisabled={!data.transactionType} />
    </div>
  );
}

function CurrencyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.,]/g, '');
          onChange(v);
        }}
        placeholder="0.00"
        className={`${INPUT_CLASS} pl-7`}
      />
    </div>
  );
}
