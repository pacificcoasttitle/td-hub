'use client';

import { useState } from 'react';
import { IN } from '@/components/admin/quick-entry/types';
import { CARD, fmtCurrency } from './constants';

export function Reveal({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  return (
    <div id={id} className={`transition-all duration-500 ease-out ${open ? 'opacity-100 translate-y-0 mb-6' : 'opacity-0 translate-y-6 max-h-0 overflow-hidden pointer-events-none mb-0'}`}>
      {open && children}
    </div>
  );
}

export function SectionShell({ icon, title, step, children }: { icon: React.ReactNode; title: string; step: number; children: React.ReactNode }) {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex items-center gap-2 px-6 py-3 bg-[#F8F9FA] border-b border-gray-100">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#F26B2B] text-white text-xs font-bold">{step}</span>
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1A2E]">{icon}{title}</span>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export function SkipLink({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return <button onClick={onClick} className="mt-4 text-xs text-[#6B7280] hover:text-[#F26B2B] transition-colors">Skip this section ↓</button>;
}

export function CurrencyInput({ value, onChange, placeholder = '0.00' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [focused, setFocused] = useState(false);
  const display = focused ? value : fmtCurrency(value);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span>
      <input className={`${IN} pl-7 tabular-nums`} value={display} placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} />
    </div>
  );
}

export function Spinner() { return <div className="w-4 h-4 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin" />; }

export function PersonIcon() { return <svg className="h-4 w-4 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>; }
export function MapIcon() { return <svg className="h-4 w-4 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
export function UsersIcon() { return <svg className="h-4 w-4 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
export function CalcIcon() { return <svg className="h-4 w-4 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>; }
export function GroupIcon() { return <svg className="h-4 w-4 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>; }
