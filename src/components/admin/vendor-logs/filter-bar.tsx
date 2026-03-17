'use client';

import { VENDORS } from './stats-panel';

export function ApiFilterBar({ vendor, onVendorChange, statusFilter, onStatusChange }: {
  vendor: string; onVendorChange: (v: string) => void;
  statusFilter: 'all' | 'success' | 'error'; onStatusChange: (v: 'all' | 'success' | 'error') => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
      <select value={vendor} onChange={(e) => onVendorChange(e.target.value)}
        className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A]">
        <option value="">All Vendors</option>
        {VENDORS.map((v) => <option key={v} value={v.toLowerCase()}>{v}</option>)}
      </select>
      <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
        {(['all', 'success', 'error'] as const).map((opt) => (
          <button key={opt} onClick={() => onStatusChange(opt)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === opt ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
            {opt === 'all' ? 'All' : opt === 'success' ? 'Success' : 'Error'}
          </button>
        ))}
      </div>
      <span className="ml-auto text-xs text-[#9CA3AF]">Auto-refreshes every 60s</span>
    </div>
  );
}

export function DocFilterBar({ actionFilter, onActionChange }: {
  actionFilter: string; onActionChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
      <select value={actionFilter} onChange={(e) => onActionChange(e.target.value)}
        className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#C5A55A]">
        <option value="">All Actions</option>
        <option value="upload">Upload</option>
        <option value="download">Download</option>
        <option value="attach">Attach to SoftPro</option>
        <option value="generate">Generate</option>
        <option value="delete">Delete</option>
      </select>
      <span className="ml-auto text-xs text-[#9CA3AF]">Auto-refreshes every 60s</span>
    </div>
  );
}
