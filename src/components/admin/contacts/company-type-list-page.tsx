'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncButton } from './sync-button';

interface Company {
  id: number;
  name: string;
  lookupCode: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

interface Props {
  title: string;
  subtitle: string;
  companyType: string;
  syncUserType: string;
}

const PAGE_SIZE = 25;

export function CompanyTypeListPage({ title, subtitle, companyType, syncUserType }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCount = useRef(0);

  const fetchCompanies = useCallback(() => {
    const id = ++fetchCount.current;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), active: activeFilter, type: companyType });
    if (search) p.set('search', search);
    fetch(`/api/companies?${p}`)
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(d => { if (id === fetchCount.current) { setCompanies(d.companies ?? []); setTotal(d.total ?? 0); } })
      .catch(e => { if (id === fetchCount.current) setError(e.message); })
      .finally(() => { if (id === fetchCount.current) setLoading(false); });
  }, [page, search, activeFilter, companyType]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">{title}</h1>
          <p className="text-sm text-[#6B7280] mt-1">{subtitle}</p>
        </div>
        <SyncButton endpoint="/api/contacts/sync" userType={syncUserType} onSuccess={fetchCompanies} />
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" value={searchInput} onChange={e => handleSearch(e.target.value)} placeholder="Search name, code, city…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] bg-white" />
        </div>
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
          {[{ v: 'true', l: 'Active' }, { v: 'false', l: 'Inactive' }, { v: 'all', l: 'All' }].map(o => (
            <button key={o.v} onClick={() => { setActiveFilter(o.v); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${activeFilter === o.v ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
              {o.l}
            </button>
          ))}
        </div>
        {!loading && <span className="text-sm text-[#6B7280] ml-auto">{total} compan{total !== 1 ? 'ies' : 'y'}</span>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Location</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                  ))}</tr>
                )) : companies.length > 0 ? companies.map(co => (
                  <tr key={co.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap">{co.name}</td>
                    <td className="px-4 py-3 text-[#6B7280] text-xs font-mono">{co.lookupCode ?? '—'}</td>
                    <td className="px-4 py-3 text-[#6B7280] max-w-[200px] truncate">{co.email ?? '—'}</td>
                    <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{co.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-[#6B7280]">{[co.city, co.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${co.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {co.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                )) : null}
              </tbody>
            </table>
            {!loading && companies.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No companies found</p>
                <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters, or run a sync.</p>
              </div>
            )}
          </div>
        )}
        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
            <p className="text-sm text-[#6B7280]">
              Showing <span className="font-medium text-[#1A1A2E]">{(page - 1) * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-[#1A1A2E]">{Math.min(page * PAGE_SIZE, total)}</span> of{' '}
              <span className="font-medium text-[#1A1A2E]">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
              <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
