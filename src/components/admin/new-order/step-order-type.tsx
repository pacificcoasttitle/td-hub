'use client';

import { useEffect, useState } from 'react';
import type { Branch, OrderTypeData } from './types';
import { ORDER_TYPES, SELECT_CLASS } from './constants';
import { FieldLabel, StepHeader, StepNav } from './shared';

export function Step1OrderType({
  data, onChange, onNext,
}: {
  data: OrderTypeData; onChange: (d: OrderTypeData) => void; onNext: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    fetch('/api/branches')
      .then((r) => r.ok ? r.json() : { branches: [] })
      .then((d) => setBranches(d.branches ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6">
      <StepHeader title="Order Type" sub="What kind of order is this?" />

      <div className="grid grid-cols-3 gap-3 mb-6">
        {ORDER_TYPES.map((ot) => (
          <button
            key={ot.value}
            onClick={() => onChange({ ...data, orderType: ot.value })}
            className={`text-left px-4 py-4 rounded-lg border-2 transition-colors ${
              data.orderType === ot.value
                ? 'border-[#C5A55A] bg-[#C5A55A]/5'
                : 'border-gray-200 hover:border-[#1B2A4A]/30'
            }`}
          >
            <p className="font-semibold text-[#1A1A2E] text-sm">{ot.label}</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{ot.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <FieldLabel>Branch</FieldLabel>
          <select
            value={data.branchId ?? ''}
            onChange={(e) => onChange({ ...data, branchId: e.target.value ? Number(e.target.value) : null })}
            className={SELECT_CLASS}
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-3 cursor-pointer py-2">
            <div className="relative">
              <input
                type="checkbox"
                checked={data.rushOrder}
                onChange={(e) => onChange({ ...data, rushOrder: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-[#C5A55A] transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">Rush Order</p>
              <p className="text-xs text-[#6B7280]">Expedited processing</p>
            </div>
          </label>
        </div>
      </div>

      <StepNav onNext={onNext} nextDisabled={!data.orderType} />
    </div>
  );
}
