'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Contact {
  id: number;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  cell: string | null;
  roles: string[];
  sourceSystem: string | null;
  isActive: boolean;
  city: string | null;
  state: string | null;
  licenseNo: string | null;
}

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

interface PaginatedResponse<T> {
  total: number;
  page: number;
  pageSize: number;
  contacts?: T[];
  companies?: T[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

type TabKey = 'contacts' | 'companies';

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'title_officer', label: 'Title Officer' },
  { value: 'escrow_officer', label: 'Escrow Officer' },
  { value: 'agent', label: 'Agent' },
  { value: 'lender', label: 'Lender' },
  { value: 'mortgage_broker', label: 'Mortgage Broker' },
];

const COMPANY_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'Escrow Company', label: 'Escrow Company' },
  { value: 'Lender', label: 'Lender' },
  { value: 'Title Company', label: 'Title Company' },
];

const ROLE_COLORS: Record<string, string> = {
  sales_rep: 'bg-indigo-100 text-indigo-800',
  title_officer: 'bg-sky-100 text-sky-800',
  escrow_officer: 'bg-teal-100 text-teal-800',
  agent: 'bg-amber-100 text-amber-800',
  lender: 'bg-purple-100 text-purple-800',
  mortgage_broker: 'bg-rose-100 text-rose-800',
};

const PAGE_SIZE = 25;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab = (searchParams.get('tab') as TabKey) || 'contacts';

  function setTab(tab: TabKey) {
    router.push(`/contacts?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">
          Contacts &amp; Companies
        </h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Unified contact directory — replaces legacy entity pages
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['contacts', 'companies'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative capitalize ${
                activeTab === tab
                  ? 'text-[#1B2A4A]'
                  : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'contacts' ? <ContactsTab /> : <CompaniesTab />}
    </div>
  );
}

// ─── Contacts Tab ───────────────────────────────────────────────────────────

function ContactsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('cPage') ?? '1');
  const currentRole = searchParams.get('role') ?? '';
  const currentSearch = searchParams.get('cSearch') ?? '';
  const currentActive = searchParams.get('active') ?? 'true';

  const [data, setData] = useState<{ contacts: Contact[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'contacts');
      const page = overrides.cPage ?? currentPage;
      const role = overrides.role ?? currentRole;
      const search = overrides.cSearch ?? currentSearch;
      const active = overrides.active ?? currentActive;
      if (Number(page) > 1) params.set('cPage', String(page));
      if (role) params.set('role', String(role));
      if (search) params.set('cSearch', String(search));
      if (active !== 'true') params.set('active', String(active));
      return `/contacts?${params}`;
    },
    [currentPage, currentRole, currentSearch, currentActive],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const apiParams = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(PAGE_SIZE),
      active: currentActive,
    });
    if (currentRole) apiParams.set('role', currentRole);
    if (currentSearch) apiParams.set('search', currentSearch);

    fetch(`/api/contacts?${apiParams}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load contacts (${res.status})`);
        return res.json() as Promise<PaginatedResponse<Contact>>;
      })
      .then((d) => setData({ contacts: d.contacts ?? [], total: d.total }))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [currentPage, currentRole, currentSearch, currentActive]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(buildUrl({ cSearch: value, cPage: 1 }));
    }, 300);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SearchInput
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Search name, email, company…"
        />
        <select
          value={currentRole}
          onChange={(e) => router.push(buildUrl({ role: e.target.value, cPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ActiveToggle
          value={currentActive}
          onChange={(v) => router.push(buildUrl({ active: v, cPage: 1 }))}
        />
        {data && !loading && (
          <span className="text-sm text-[#6B7280] ml-auto">
            {data.total} contact{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Role(s)</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
                  : data && data.contacts.length > 0
                    ? data.contacts.map((c) => (
                        <ContactRow
                          key={c.id}
                          contact={c}
                          expanded={expandedId === c.id}
                          onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.contacts.length === 0 && (
              <EmptyState message="No contacts found. Try adjusting your search or filters." />
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination
            current={currentPage}
            total={totalPages}
            count={data.total}
            pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ cPage: p }))}
          />
        )}
      </div>
    </>
  );
}

function ContactRow({
  contact,
  expanded,
  onToggle,
}: {
  contact: Contact;
  expanded: boolean;
  onToggle: () => void;
}) {
  const name = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—';

  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap">{name}</td>
        <td className="px-4 py-3 text-[#1A1A2E] max-w-[180px] truncate">{contact.companyName ?? '—'}</td>
        <td className="px-4 py-3 text-[#6B7280] max-w-[200px] truncate">{contact.email ?? '—'}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{contact.phone ?? contact.cell ?? '—'}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {contact.roles.length > 0
              ? contact.roles.map((r) => <RoleBadge key={r} role={r} />)
              : <span className="text-[#6B7280]">—</span>}
          </div>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <SourceBadge source={contact.sourceSystem} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <StatusDot active={contact.isActive} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={7} className="px-4 py-4">
            <ContactDetail contact={contact} />
          </td>
        </tr>
      )}
    </>
  );
}

function ContactDetail({ contact }: { contact: Contact }) {
  const name = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—';
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
      <Field label="Full Name" value={name} />
      <Field label="Email" value={contact.email} />
      <Field label="Phone" value={contact.phone} />
      <Field label="Cell" value={contact.cell} />
      <Field label="Company" value={contact.companyName} />
      <Field label="City / State" value={[contact.city, contact.state].filter(Boolean).join(', ') || null} />
      <Field label="License #" value={contact.licenseNo} />
      <Field label="Source" value={contact.sourceSystem} />
    </div>
  );
}

// ─── Companies Tab ──────────────────────────────────────────────────────────

function CompaniesTab() {
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

    const apiParams = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(PAGE_SIZE),
      active: currentActive,
    });
    if (currentType) apiParams.set('type', currentType);
    if (currentSearch) apiParams.set('search', currentSearch);

    fetch(`/api/companies?${apiParams}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load companies (${res.status})`);
        return res.json() as Promise<PaginatedResponse<Company>>;
      })
      .then((d) => setData({ companies: d.companies ?? [], total: d.total }))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [currentPage, currentType, currentSearch, currentActive]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(buildUrl({ kSearch: value, kPage: 1 }));
    }, 300);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SearchInput
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Search name, lookup code, city…"
        />
        <select
          value={currentType}
          onChange={(e) => router.push(buildUrl({ type: e.target.value, kPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
        >
          {COMPANY_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ActiveToggle
          value={currentActive}
          onChange={(v) => router.push(buildUrl({ kActive: v, kPage: 1 }))}
        />
        {data && !loading && (
          <span className="text-sm text-[#6B7280] ml-auto">
            {data.total} compan{data.total !== 1 ? 'ies' : 'y'}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : (
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
                        <CompanyRow
                          key={co.id}
                          company={co}
                          expanded={expandedId === co.id}
                          onToggle={() => setExpandedId(expandedId === co.id ? null : co.id)}
                        />
                      ))
                    : null}
              </tbody>
            </table>
            {!loading && data && data.companies.length === 0 && (
              <EmptyState message="No companies found. Try adjusting your search or filters." />
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination
            current={currentPage}
            total={totalPages}
            count={data.total}
            pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ kPage: p }))}
          />
        )}
      </div>
    </>
  );
}

function CompanyRow({
  company,
  expanded,
  onToggle,
}: {
  company: Company;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50 cursor-pointer transition-colors">
        <td className="px-4 py-3 font-medium text-[#1A1A2E]">{company.name}</td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{company.companyType ?? '—'}</td>
        <td className="px-4 py-3 text-[#6B7280] font-mono text-xs">{company.lookupCode ?? '—'}</td>
        <td className="px-4 py-3 text-[#1A1A2E]">{company.city ?? '—'}</td>
        <td className="px-4 py-3 text-[#1A1A2E]">{company.state ?? '—'}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <StatusDot active={company.isActive} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80">
          <td colSpan={6} className="px-4 py-4">
            <CompanyDetail company={company} />
          </td>
        </tr>
      )}
    </>
  );
}

function CompanyDetail({ company }: { company: Company }) {
  return (
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
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 max-w-sm">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white"
      />
    </div>
  );
}

function ActiveToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const options = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' },
    { value: 'all', label: 'All' },
  ];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-[#1B2A4A] text-white'
              : 'bg-white text-[#6B7280] hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {role.replace(/_/g, ' ')}
    </span>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  const isSoftPro = source === 'softpro';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        isSoftPro ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {isSoftPro ? 'SoftPro' : 'Manual'}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
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

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-12 text-center">
      <p className="text-[#1A1A2E] font-medium">No results</p>
      <p className="text-sm text-[#6B7280] mt-1">{message}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-red-600 font-medium">{message}</p>
      <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
    </div>
  );
}

function Pagination({
  current,
  total,
  count,
  pageSize,
  onChange,
}: {
  current: number;
  total: number;
  count: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = buildPageRange(current, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
      <p className="text-sm text-[#6B7280]">
        Showing{' '}
        <span className="font-medium text-[#1A1A2E]">{(current - 1) * pageSize + 1}</span>–
        <span className="font-medium text-[#1A1A2E]">{Math.min(current * pageSize, count)}</span>{' '}
        of <span className="font-medium text-[#1A1A2E]">{count}</span>
      </p>
      <div className="flex items-center gap-1">
        <PagBtn disabled={current <= 1} onClick={() => onChange(current - 1)}>‹ Prev</PagBtn>
        {pages.map((p, i) =>
          p === null ? (
            <span key={`e${i}`} className="px-1 text-[#6B7280]">…</span>
          ) : (
            <PagBtn key={p} active={p === current} onClick={() => onChange(p)}>{p}</PagBtn>
          ),
        )}
        <PagBtn disabled={current >= total} onClick={() => onChange(current + 1)}>Next ›</PagBtn>
      </div>
    </div>
  );
}

function PagBtn({
  children,
  disabled,
  active,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active
          ? 'bg-[#1B2A4A] text-white'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildPageRange(current: number, total: number): (number | null)[] {
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
