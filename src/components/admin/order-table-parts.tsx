'use client';

import { useState, useEffect, useRef } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
}

/* ── Constants ─────────────────────────────────────────────────────────────── */

export const COL_COUNT = 10;

/* ── Actions Dropdown ──────────────────────────────────────────────────────── */

export function ActionsDropdown({ onDetails, onConfirmations }: { onDetails: () => void; onConfirmations: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(o => !o)}
        className="w-7 h-7 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-gray-100 hover:text-[#1A1A2E] transition-colors">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <button onClick={() => { setOpen(false); onDetails(); }}
            className="w-full text-left px-3 py-2 text-sm text-[#1A1A2E] hover:bg-gray-50 transition-colors">
            Order Details
          </button>
          <button onClick={() => { setOpen(false); onConfirmations(); }}
            className="w-full text-left px-3 py-2 text-sm text-[#1A1A2E] hover:bg-gray-50 transition-colors">
            Confirmations
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

export function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: COL_COUNT }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 bg-gray-200 rounded animate-pulse ${i === 2 ? 'w-32' : i === 0 ? 'w-6 mx-auto' : 'w-16'}`} />
        </td>
      ))}
    </tr>
  );
}

export function PagBtn({ children, disabled, active, onClick }: {
  children: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active ? 'bg-[#1B2A4A] text-white' : disabled ? 'text-gray-300 cursor-not-allowed' : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}>
      {children}
    </button>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

export function formatAddress(property: OrderProperty | null): string {
  if (!property) return '—';
  const parts = [property.address, property.city, property.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function buildPageRange(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | null)[] = [1];
  if (current > 3) pages.push(null);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push(null);
  pages.push(total);
  return pages;
}
