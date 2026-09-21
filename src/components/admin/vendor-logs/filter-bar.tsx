'use client';

import { VENDORS } from './stats-panel';

export interface ApiFilterBarProps {
  vendor: string;
  onVendorChange: (v: string) => void;
  statusFilter: 'all' | 'success' | 'error';
  onStatusChange: (v: 'all' | 'success' | 'error') => void;
  search: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit: () => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
}

export function ApiFilterBar({
  vendor, onVendorChange, statusFilter, onStatusChange,
  search, onSearchChange, onSearchSubmit,
  dateFrom, onDateFromChange, dateTo, onDateToChange,
}: ApiFilterBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
      <select value={vendor} onChange={(e) => onVendorChange(e.target.value)}
        className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A]">
        <option value="">All Vendors</option>
        {VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
      <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
        {(['all', 'success', 'error'] as const).map((opt) => (
          <button key={opt} onClick={() => onStatusChange(opt)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === opt ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
            {opt === 'all' ? 'All' : opt === 'success' ? 'Success' : 'Error'}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearchSubmit(); }}
        placeholder="Search operation or file #…"
        className="h-9 w-48 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A] placeholder:text-[#9CA3AF]"
      />
      <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)}
        className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A] text-[#6B7280]" />
      <span className="text-xs text-[#9CA3AF]">to</span>
      <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)}
        className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A] text-[#6B7280]" />
    </div>
  );
}
