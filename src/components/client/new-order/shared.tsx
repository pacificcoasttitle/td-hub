'use client';

import type { Person } from './types';
import { IN } from './types';

export function SH({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-5"><h3 className="text-lg font-semibold text-[#1A1A2E]">{title}</h3><p className="text-sm text-[#6B7280] mt-0.5">{sub}</p></div>;
}

export function FL({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#6B7280] mb-1">{children}</label>;
}

export function Nav({ onPrev, onNext, nextDisabled }: { onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
      {onPrev ? <button onClick={onPrev} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">← Back</button> : <div />}
      {onNext && <button onClick={onNext} disabled={nextDisabled} className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors min-h-[44px]">Continue →</button>}
    </div>
  );
}

export function PF({ person, onChange }: { person: Person; onChange: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><FL>First Name</FL><input className={IN} value={person.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First" /></div>
      <div><FL>Middle</FL><input className={IN} value={person.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle" /></div>
      <div><FL>Last Name</FL><input className={IN} value={person.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last" /></div>
    </div>
  );
}

export function CurrInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">$</span>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" className={`${IN} pl-7`} />
    </div>
  );
}

export function RS({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{title}</p><button onClick={onEdit} className="text-xs text-[#1B2A4A] font-medium min-h-[44px]">Edit</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">{children}</div>
    </div>
  );
}

export function RF({ l, v }: { l: string; v: string }) {
  return <div className="flex items-baseline gap-2"><span className="text-xs text-[#6B7280] flex-shrink-0">{l}:</span><span className="text-sm text-[#1A1A2E] font-medium truncate">{v}</span></div>;
}
