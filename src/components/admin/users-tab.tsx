'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SkeletonRow, Pagination } from './shared-table';

interface User {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  isActive: boolean;
  createdAt: string;
}

const PAGE_SIZE = 25;

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'cs_admin', label: 'CS Admin' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'title_officer', label: 'Title Officer' },
  { value: 'escrow_officer', label: 'Escrow Officer' },
  { value: 'client', label: 'Client' },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-800',
  admin: 'bg-indigo-100 text-indigo-800',
  cs_admin: 'bg-purple-100 text-purple-800',
  sales_rep: 'bg-sky-100 text-sky-800',
  title_officer: 'bg-teal-100 text-teal-800',
  escrow_officer: 'bg-amber-100 text-amber-800',
  client: 'bg-gray-100 text-gray-700',
};

export function UsersTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('uPage') ?? '1');
  const currentRole = searchParams.get('uRole') ?? '';
  const currentSearch = searchParams.get('uSearch') ?? '';
  const currentActive = searchParams.get('uActive') ?? 'all';

  const [data, setData] = useState<{ users: User[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'users');
      const page = overrides.uPage ?? currentPage;
      const role = overrides.uRole ?? currentRole;
      const search = overrides.uSearch ?? currentSearch;
      const active = overrides.uActive ?? currentActive;
      if (Number(page) > 1) params.set('uPage', String(page));
      if (role) params.set('uRole', String(role));
      if (search) params.set('uSearch', String(search));
      if (active !== 'all') params.set('uActive', String(active));
      return `/users?${params}`;
    },
    [currentPage, currentRole, currentSearch, currentActive],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE), active: currentActive });
    if (currentRole) apiParams.set('role', currentRole);
    if (currentSearch) apiParams.set('search', currentSearch);
    fetch(`/api/users?${apiParams}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`Failed to load users (${res.status})`); return res.json(); })
      .then((d) => setData({ users: d.users, total: d.total }))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [currentPage, currentRole, currentSearch, currentActive]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { router.push(buildUrl({ uSearch: value, uPage: 1 })); }, 300);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={searchInput} onChange={(e) => handleSearchChange(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white" />
        </div>
        <select value={currentRole} onChange={(e) => router.push(buildUrl({ uRole: e.target.value, uPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ActiveToggle value={currentActive} onChange={(v) => router.push(buildUrl({ uActive: v, uPage: 1 }))} />
        {data && !loading && <span className="text-sm text-[#6B7280] ml-auto">{data.total} user{data.total !== 1 ? 's' : ''}</span>}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <p className="text-red-600 font-medium">{error}</p>
            <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Branch</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
                  : data && data.users.length > 0
                    ? data.users.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap">{u.displayName || '—'}</td>
                          <td className="px-4 py-3 text-[#6B7280] max-w-[220px] truncate">{u.email ?? '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><RoleBadge role={u.role} /></td>
                          <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">
                            {u.branchCode ? <span className="font-mono text-xs">{u.branchCode}</span> : <span className="text-[#6B7280]">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap"><StatusDot active={u.isActive} /></td>
                          <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(u.createdAt)}</td>
                        </tr>
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.users.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No users found</p>
                <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p>
              </div>
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination current={currentPage} total={totalPages} count={data.total} pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ uPage: p }))} />
        )}
      </div>
    </>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{role.replace(/_/g, ' ')}</span>;
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function ActiveToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [{ value: 'all', label: 'All' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${value === o.value ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}
