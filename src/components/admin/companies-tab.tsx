'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from './shared-table';
import { SearchInput, ActiveToggle, StatusDot } from './contacts-tab';

interface Company {
  id: number;
  name: string;
  companyType: string | null;
  lookupCode: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

interface PaginatedCompanies {
  total: number;
  page: number;
  pageSize: number;
  companies?: Company[];
}

const COMPANY_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'Escrow Company', label: 'Escrow Company' },
  { value: 'Lender', label: 'Lender' },
  { value: 'Title Company', label: 'Title Company' },
];

const PAGE_SIZE = 25;

export function CompaniesTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('kPage') ?? '1');
  const currentType = searchParams.get('type') ?? '';
  const currentSearch = searchParams.get('kSearch') ?? '';
  const currentActive = searchParams.get('kActive') ?? 'true';

  const [data, setData] = useState<{ companies: Company[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'companies');
      const page = overrides.kPage ?? currentPage;
      const type = overrides.type ?? currentType;
      const search = overrides.kSearch ?? currentSearch;
      const active = overrides.kActive ?? currentActive;
      if (Number(page) > 1) params.set('kPage', String(page));
      if (type) params.set('type', String(type));
      if (search) params.set('kSearch', String(search));
      if (active !== 'true') params.set('kActive', String(active));
      return `/contacts?${params}`;
    },
    [currentPage, currentType, currentSearch, currentActive],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE), active: currentActive });
    if (currentType) apiParams.set('type', currentType);
    if (currentSearch) apiParams.set('search', currentSearch);
    fetch(`/api/companies?${apiParams}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`Failed to load companies (${res.status})`); return res.json() as Promise<PaginatedCompanies>; })
      .then((d) => setData({ companies: d.companies ?? [], total: d.total }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentPage, currentType, currentSearch, currentActive]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { router.push(buildUrl({ kSearch: value, kPage: 1 })); }, 300);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SearchInput value={searchInput} onChange={handleSearchChange} placeholder="Search name, lookup code, city…" />
        <select value={currentType} onChange={(e) => router.push(buildUrl({ type: e.target.value, kPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
          {COMPANY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ActiveToggle value={currentActive} onChange={(v) => router.push(buildUrl({ kActive: v, kPage: 1 }))} />
        {data && !loading && <span className="text-sm text-[#6B7280] ml-auto">{data.total} compan{data.total !== 1 ? 'ies' : 'y'}</span>}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? <ErrorBlock message={error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Lookup Code</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">City</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">State</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
                  : data && data.companies.length > 0
                    ? data.companies.map((co) => (
                        <CompanyRow key={co.id} company={co} expanded={expandedId === co.id}
                          onToggle={() => setExpandedId(expandedId === co.id ? null : co.id)} />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.companies.length === 0 && <EmptyState message="No companies found. Try adjusting your search or filters." />}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination current={currentPage} total={totalPages} count={data.total} pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ kPage: p }))} />
        )}
      </div>
    </>
  );
}

function CompanyRow({ company, expanded, onToggle }: { company: Company; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 font-medium text-[#1A1A2E]">{company.name}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{company.companyType ?? '—'}</td>
        <td className="px-4 py-3 text-[#6B7280] font-mono text-xs">{company.lookupCode ?? '—'}</td>
        <td className="px-4 py-3 text-[#1A1A2E]">{company.city ?? '—'}</td>
        <td className="px-4 py-3 text-[#1A1A2E]">{company.state ?? '—'}</td>
        <td className="px-4 py-3 whitespace-nowrap"><StatusDot active={company.isActive} /></td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <Field label="Name" value={company.name} />
              <Field label="Type" value={company.companyType} />
              <Field label="Lookup Code" value={company.lookupCode} />
              <Field label="Phone" value={company.phone} />
              <Field label="Email" value={company.email} />
              <Field label="City" value={company.city} />
              <Field label="State" value={company.state} />
              <Field label="Status" value={company.isActive ? 'Active' : 'Inactive'} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="font-medium text-[#1A1A2E] mt-0.5">{value || '—'}</p>
    </div>
  );
}
