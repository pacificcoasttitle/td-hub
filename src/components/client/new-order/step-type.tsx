'use client';

import { ORDER_TYPES } from './types';
import { SH, Nav } from './shared';

export function StepType({ data, onChange, onNext }: { data: { type: string; rush: boolean }; onChange: (d: { type: string; rush: boolean }) => void; onNext: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Order Type" sub="What services do you need?" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {ORDER_TYPES.map((ot) => (
          <button key={ot.value} onClick={() => onChange({ ...data, type: ot.value })}
            className={`text-left px-4 py-4 rounded-lg border-2 transition-colors min-h-[70px] ${data.type === ot.value ? 'border-[#1B2A4A] bg-[#1B2A4A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/30'}`}>
            <p className="font-semibold text-[#1A1A2E] text-sm">{ot.label}</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{ot.sub}</p>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 cursor-pointer py-2 min-h-[44px]">
        <input type="checkbox" checked={data.rush} onChange={(e) => onChange({ ...data, rush: e.target.checked })} className="rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]/40 h-5 w-5" />
        <div>
          <p className="text-sm font-medium text-[#1A1A2E]">Rush Order</p>
          <p className="text-xs text-[#6B7280]">Expedited processing</p>
        </div>
      </label>
      <Nav onNext={onNext} nextDisabled={!data.type} />
    </div>
  );
}
