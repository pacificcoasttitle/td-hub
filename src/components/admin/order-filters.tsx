'use client';

import { useEffect, useState } from 'react';

function toInternalValue(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, '_');
}

const FALLBACK_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_process', label: 'In Process' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'duplicate', label: 'Duplicate' },
];

export interface SortOption { label: string; value: string }

const SEL =
  'px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]';

export function OrderFilters({
  searchInput, onSearchChange, currentStatus, onStatusChange,
  sortOptions, currentSort, onSortChange,
}: {
  searchInput: string;
  onSearchChange: (value: string) => void;
  currentStatus: string;
  onStatusChange: (status: string) => void;
  sortOptions?: SortOption[];
  currentSort?: string;
  onSortChange?: (value: string) => void;
}) {
  const [options, setOptions] = useState(FALLBACK_OPTIONS);

  useEffect(() => {
    fetch('/api/orders/statuses')
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (body?.statuses?.length) {
          const live = [
            { value: '', label: 'All Statuses' },
            ...body.statuses.map((s: string) => ({ value: toInternalValue(s), label: s })),
          ];
          setOptions(live);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="relative flex-1 max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search file number or address…"
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
        />
      </div>
      <select value={currentStatus} onChange={(e) => onStatusChange(e.target.value)} className={SEL}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {sortOptions && onSortChange && (
        <select value={currentSort ?? ''} onChange={(e) => onSortChange(e.target.value)} className={SEL}>
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
