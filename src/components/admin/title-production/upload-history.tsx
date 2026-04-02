'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Upload {
  id: number;
  documentName: string | null;
  orderNumber: string | null;
  createdAt: string;
  isSynced: boolean;
  publicUrl: string | null;
}

const PAGE_SIZE = 20;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface Props { refreshKey: number }

export function UploadHistory({ refreshKey }: Props) {
  const [rows, setRows] = useState<Upload[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchData = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) p.set('search', search);
    fetch(`/api/title-production/uploads?${p}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setRows(d.uploads ?? []); setTotal(d.total ?? 0); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  }

  async function copyLink(url: string, id: number) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard not available */ }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200">
        <h2 className="text-lg font-semibold text-[#1B2A4A]">Upload History</h2>
        <div className="relative w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" value={searchInput} onChange={e => handleSearch(e.target.value)} placeholder="Search order # or doc name…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="text-left px-4 py-3 font-medium text-[#6B7280] w-12">#</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Document Name</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Order Number</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Created At</th>
              <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Synced</th>
              <th className="px-4 py-3 font-medium text-[#6B7280]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
              ))}</tr>
            )) : rows.length > 0 ? rows.map((r, idx) => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-[#9CA3AF]">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                <td className="px-4 py-3 font-medium text-[#1A1A2E]">{r.documentName ?? '—'}</td>
                <td className="px-4 py-3 text-[#1A1A2E]">{r.orderNumber ?? '—'}</td>
                <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.isSynced ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {r.isSynced ? '✅ Synced' : '❌ Failed'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {r.publicUrl && (
                      <>
                        <button onClick={() => window.open(r.publicUrl!, '_blank')}
                          className="text-xs text-[#1B2A4A] hover:text-[#F26B2B] font-medium transition-colors">View</button>
                        <span className="text-gray-300">|</span>
                        <button onClick={() => copyLink(r.publicUrl!, r.id)}
                          className="text-xs text-[#1B2A4A] hover:text-[#F26B2B] font-medium transition-colors">
                          {copied === r.id ? 'Copied!' : 'Copy Link'}
                        </button>
                      </>
                    )}
                    {!r.publicUrl && <span className="text-xs text-[#9CA3AF]">—</span>}
                  </div>
                </td>
              </tr>
            )) : null}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-[#1A1A2E] font-medium">No uploads yet</p>
            <p className="text-sm text-[#6B7280] mt-1">Upload documents above to get started.</p>
          </div>
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing <span className="font-medium">{(page - 1) * PAGE_SIZE + 1}</span>–<span className="font-medium">{Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-medium">{total}</span>
          </p>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
            <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
