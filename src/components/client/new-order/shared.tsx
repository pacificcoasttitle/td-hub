'use client';

import type { Person } from './types';
import { IN } from './types';

export function SH({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-xl font-semibold text-[#1B2A4A]">{title}</h3>
      <p className="text-[#4B5563] mt-1">{sub}</p>
    </div>
  );
}

export function FL({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-[#1B2A4A] mb-1.5">{children}</label>;
}

export function Nav({ onPrev, onNext, nextDisabled, nextLabel }: { onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#E5E7EB]">
      {onPrev ? (
        <button onClick={onPrev} className="px-5 py-3 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 transition-colors h-12 inline-flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
      ) : <div />}
      {onNext && (
        <button onClick={onNext} disabled={nextDisabled} className="px-6 py-3 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-12 inline-flex items-center gap-2">
          {nextLabel ?? 'Continue'}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  );
}

export function PF({ person, onChange }: { person: Person; onChange: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div><FL>First Name</FL><input className={IN} value={person.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First" /></div>
      <div><FL>Middle</FL><input className={IN} value={person.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle" /></div>
      <div><FL>Last Name</FL><input className={IN} value={person.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last" /></div>
    </div>
  );
}

export function CurrInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" className={`${IN} pl-7`} />
    </div>
  );
}

export function RS({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-[#FAFAFA] rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{title}</p>
        <button onClick={onEdit} className="text-sm text-[#F26B2B] hover:text-[#E05A1A] font-medium min-h-[44px]">Edit</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">{children}</div>
    </div>
  );
}

export function RF({ l, v }: { l: string; v: string }) {
  return <div className="flex items-baseline gap-2"><span className="text-xs text-[#6B7280] flex-shrink-0">{l}:</span><span className="text-sm text-[#1B2A4A] font-medium truncate">{v}</span></div>;
}
