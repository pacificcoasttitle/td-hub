'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CompanySyncAllButton } from '@/components/admin/contacts/company-sync-all-button';
import { CompanyFormModal, type CompanyRecord } from '@/components/admin/contacts/company-form-modal';
import { CompanyOfficerModal, type OfficerTarget } from '@/components/admin/contacts/company-officer-modal';

interface StaffOption { id: number; name: string }

interface Company {
  id: number;
  name: string;
  companyType: string | null;
  lookupCode: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  salesRepId: number | null;
  titleOfficerId: number | null;
  loanUnderwriter: string | null;
  salesUnderwriter: string | null;
  deliverableEmails: string[] | null;
}

type SortField = 'name' | 'companyType' | 'city' | 'createdAt';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;
const TYPE_OPTS = [
  { value: '', label: 'All Types' }, { value: 'escrow_company', label: 'Escrow Company' },
  { value: 'lender', label: 'Lender' }, { value: 'mortgage_broker', label: 'Mortgage Broker' },
  { value: 'selling_agent', label: 'Selling Agent' }, { value: 'underwriter', label: 'Underwriter' },
];

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<{ salesReps: StaffOption[]; titleOfficers: StaffOption[] }>({ salesReps: [], titleOfficers: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [editCompany, setEditCompany] = useState<CompanyRecord | null>(null);
  const [officerTarget, setOfficerTarget] = useState<OfficerTarget | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchCompanies = useCallback(() => {
    setLoading(true); setError(null);
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), active: activeFilter, sortField, sortDir });
    if (typeFilter) p.set('type', typeFilter);
    if (search) p.set('search', search);
    fetch(`/api/companies?${p}`)
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(d => { setCompanies(d.companies ?? []); setTotal(d.total ?? 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, search, typeFilter, activeFilter, sortField, sortDir]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  useEffect(() => {
    fetch('/api/staff/list')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStaff({ salesReps: d.salesReps ?? [], titleOfficers: d.titleOfficers ?? [] }); })
      .catch(() => {});
  }, []);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <svg className="h-3 w-3 ml-1 opacity-0 group-hover/th:opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>;
    return sortDir === 'asc'
      ? <svg className="h-3 w-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
      : <svg className="h-3 w-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>;
  }

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  }

  function openEdit(c: Company) {
    setEditCompany({ id: c.id, name: c.name, companyType: c.companyType ?? '', lookupCode: c.lookupCode ?? '', city: c.city ?? '', state: c.state ?? '', zip: '', phone: c.phone ?? '', email: c.email ?? '', isActive: c.isActive });
    setModalOpen(true);
  }

  function openOfficers(c: Company) {
    setOfficerTarget({ companyId: c.id, companyName: c.name, salesRepId: c.salesRepId, titleOfficerId: c.titleOfficerId, loanUnderwriter: c.loanUnderwriter, salesUnderwriter: c.salesUnderwriter });
  }

  function resolveName(id: number | null, list: StaffOption[]): string {
    if (!id) return '—';
    return list.find(s => s.id === id)?.name ?? '—';
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Companies</h1>
          <p className="text-sm text-[#6B7280] mt-1">Company directory with assignment management</p>
        </div>
        <div className="flex items-center gap-2">
          <CompanySyncAllButton onSuccess={fetchCompanies} />
          <button onClick={() => { setEditCompany(null); setModalOpen(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Company
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-400 italic mb-4">Officer assignments auto-fill the open order form when a client from this company opens an order.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" value={searchInput} onChange={e => handleSearch(e.target.value)} placeholder="Search name, code, city…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] bg-white" />
        </div>
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]">
          {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
          {[{ v: 'true', l: 'Active' }, { v: 'false', l: 'Inactive' }, { v: 'all', l: 'All' }].map(o => (
            <button key={o.v} onClick={() => { setActiveFilter(o.v); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${activeFilter === o.v ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>{o.l}</button>
          ))}
        </div>
        {!loading && <span className="text-sm text-[#6B7280] ml-auto">{total} compan{total !== 1 ? 'ies' : 'y'}</span>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] cursor-pointer select-none group/th" onClick={() => toggleSort('name')}>
                    <span className="inline-flex items-center">Name<SortIcon field="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280] cursor-pointer select-none group/th" onClick={() => toggleSort('companyType')}>
                    <span className="inline-flex items-center">Type<SortIcon field="companyType" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Sales Rep</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Title Officer</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>)}</tr>
                )) : companies.length > 0 ? companies.map(co => (
                  <tr key={co.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap max-w-[240px] truncate">{co.name}</td>
                    <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-xs">{co.companyType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap text-xs max-w-[160px] truncate">{resolveName(co.salesRepId, staff.salesReps)}</td>
                    <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap text-xs max-w-[160px] truncate">{resolveName(co.titleOfficerId, staff.titleOfficers)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${co.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {co.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => openOfficers(co)} title="Assign Officers" className="text-[#F26B2B] hover:text-[#E05A1A]">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </button>
                        <button onClick={() => openEdit(co)} title="Edit" className="text-[#6B7280] hover:text-[#1B2A4A]">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : null}
              </tbody>
            </table>
            {!loading && companies.length === 0 && <div className="p-12 text-center"><p className="text-[#1A1A2E] font-medium">No companies found</p><p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p></div>}
          </div>
        )}
        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
            <p className="text-sm text-[#6B7280]">Showing <span className="font-medium">{(page - 1) * PAGE_SIZE + 1}</span>–<span className="font-medium">{Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-medium">{total}</span></p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
              <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-md text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
            </div>
          </div>
        )}
      </div>

      <CompanyFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={fetchCompanies} company={editCompany} />
      <CompanyOfficerModal
        open={!!officerTarget}
        target={officerTarget}
        salesReps={staff.salesReps}
        titleOfficers={staff.titleOfficers}
        onClose={() => setOfficerTarget(null)}
        onSuccess={fetchCompanies}
      />
    </div>
  );
}
