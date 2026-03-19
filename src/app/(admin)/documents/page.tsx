'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { DocumentsTable, PAGE_LIMIT } from '@/components/admin/DocumentsTable';
import type { DocsResponse } from '@/components/admin/DocumentsTable';

/* ── Tab definitions ───────────────────────────────────────────────────────── */

type TabKey = 'open_order' | 'proposed_insured' | 'cpl';

const TABS: { key: TabKey; label: string; categories: string; emptyLabel: string }[] = [
  { key: 'open_order',       label: 'Open Order Documents', categories: 'legal_vesting,tax,grant_deed', emptyLabel: 'No Open Order documents found.' },
  { key: 'proposed_insured', label: 'Proposed Insured',     categories: 'proposed_insured',              emptyLabel: 'No Proposed Insured documents found.' },
  { key: 'cpl',              label: 'CPLs',                 categories: 'cpl',                           emptyLabel: 'No CPL documents found.' },
];

const SUB_FILTERS: { value: string; label: string }[] = [
  { value: '',              label: 'All Types' },
  { value: 'legal_vesting', label: 'Legal Vesting' },
  { value: 'tax',           label: 'Tax' },
  { value: 'grant_deed',    label: 'Grant Deed' },
];

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function DocumentsPage() {
  const [tab, setTab] = useState<TabKey>('open_order');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [subCat, setSubCat] = useState('');

  const [data, setData] = useState<DocsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const activeTab = TABS.find(t => t.key === tab)!;

  const resolvedCategory = tab === 'open_order' && subCat ? subCat : activeTab.categories;

  /* ── Debounced search ── */
  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 500);
  }

  /* ── Tab switch ── */
  function switchTab(key: TabKey) {
    setTab(key);
    setPage(1);
    setSubCat('');
  }

  /* ── Clear filters ── */
  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
    setSubCat('');
    setPage(1);
  }

  const hasFilters = debouncedSearch || dateFrom || dateTo || subCat;

  /* ── Fetch ── */
  const fetchDocs = useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
      category: resolvedCategory,
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    fetch(`/api/admin/documents?${params}`, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json() as Promise<DocsResponse>; })
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [page, resolvedCategory, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => { return fetchDocs(); }, [fetchDocs]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Documents</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        {TABS.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Search by file number">
            <input type="text" value={search} onChange={e => onSearchChange(e.target.value)}
              placeholder="Search by file number..."
              className="h-9 w-48 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          {tab === 'open_order' && (
            <FilterField label="Document Type">
              <select value={subCat} onChange={e => { setSubCat(e.target.value); setPage(1); }}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]">
                {SUB_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </FilterField>
          )}

          <FilterField label="From">
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          <FilterField label="To">
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
            />
          </FilterField>

          {hasFilters && (
            <div className="pb-px">
              <button onClick={clearFilters}
                className="h-9 px-4 text-sm font-medium text-[#6B7280] border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <DocumentsTable
        data={data}
        loading={loading}
        error={error}
        emptyLabel={activeTab.emptyLabel}
        currentPage={page}
        onPageChange={setPage}
      />
    </div>
  );
}

/* ── Filter field wrapper ──────────────────────────────────────────────────── */

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[#6B7280]">{label}</label>
      {children}
    </div>
  );
}
