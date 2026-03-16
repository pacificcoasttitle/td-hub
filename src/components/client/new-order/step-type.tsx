'use client';

import { ORDER_TYPES } from './types';
import { SH, Nav } from './shared';

export function StepType({ data, onChange, onNext }: { data: { type: string; rush: boolean }; onChange: (d: { type: string; rush: boolean }) => void; onNext: () => void }) {
  return (
    <div className="p-6 sm:p-8">
      <SH title="Select Order Type" sub="Choose the type of transaction for this order" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {ORDER_TYPES.map((ot) => (
          <button key={ot.value} onClick={() => onChange({ ...data, type: ot.value })}
            className={`text-left p-5 rounded-xl border-2 transition-all min-h-[80px] ${data.type === ot.value ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'}`}>
            <p className="font-semibold text-[#1B2A4A] text-sm">{ot.label}</p>
            <p className="text-xs text-[#4B5563] mt-1">{ot.sub}</p>
            {data.type === ot.value && (
              <div className="mt-2">
                <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
            )}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 cursor-pointer py-2 min-h-[44px]">
        <input type="checkbox" checked={data.rush} onChange={(e) => onChange({ ...data, rush: e.target.checked })} className="rounded border-[#E5E7EB] text-[#F26B2B] focus:ring-[#F26B2B]/40 h-5 w-5" />
        <div>
          <p className="text-sm font-medium text-[#1B2A4A]">Rush Order</p>
          <p className="text-xs text-[#4B5563]">Expedited processing</p>
        </div>
      </label>
      <Nav onNext={onNext} nextDisabled={!data.type} />
    </div>
  );
}
