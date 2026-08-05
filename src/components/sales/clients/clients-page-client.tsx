'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Briefcase, Clock, Download, Plus, Search, Upload } from 'lucide-react';
import { RepSelector } from '../rep-selector';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from '@/components/admin/shared-table';
import { ClientFormModal } from './client-form-modal';
import { ImportClientsModal } from './import-clients-modal';
import { AddFromTransactionsModal } from './add-from-transactions-modal';
import { TypeBadge } from './type-badge';
import { RecentActivity } from './recent-activity';
import { displayClientName } from './display';
import { SignalChip } from './signal-chip';
import {
  decodeListState, encodeListState, profileHref, rememberScroll, takeRememberedScroll,
} from './list-state';
import { CRM_CLIENT_TYPES, CRM_TYPE_LABEL_PLURAL } from '@/lib/domain/crm/types';
import type { ClientListResponse, CrmClient } from './types';

const PAGE_SIZE = 25;

export function fmtBusinessIndicator(business: CrmClient['business']): string | null {
  if (!business || business.orderCount === 0) return null;
  const n = business.orderCount;
  const last = business.lastOpenedAt ? new Date(business.lastOpenedAt) : null;
  const when = last
    ? ` · last ${last.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
    : '';
  return `${n} order${n === 1 ? '' : 's'}${when}`;
}

/** Short, scannable last-order date for a list row: "Jul 29, 2026". */
export function fmtLastOrder(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

interface Props {
  role: 'sales_rep' | 'sales_manager';
}

export function ClientsPageClient({ role }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Seeded once from the URL: arriving via Back from a profile must rebuild the
  // exact list the rep left, not a fresh unfiltered one.
  const initial = useRef(decodeListState(searchParams.toString())).current;

  const [repId, setRepId] = useState<number | null>(initial.repId);
  const [page, setPage] = useState(initial.page);
  const [searchInput, setSearchInput] = useState(initial.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.search);
  const [data, setData] = useState<ClientListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>(initial.type);
  const [quietOnly, setQuietOnly] = useState(initial.quietOnly);
  const [activityKey, setActivityKey] = useState(0);
  const [showFromTx, setShowFromTx] = useState(false);
  const [editClient, setEditClient] = useState<CrmClient | null>(null);
  const fetchCount = useRef(0);
  const restoredScroll = useRef(false);

  const listState = {
    search: debouncedSearch, type: typeFilter, quietOnly, page, repId,
  };

  // A manager looking at a rep's list is a guest: read-only (spec §5/§9).
  const readOnly = role === 'sales_manager' && repId !== null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const firstRun = useRef(true);
  useEffect(() => {
    // Skip on mount, or restoring "page 3 filtered by escrow" would snap to 1.
    if (firstRun.current) { firstRun.current = false; return; }
    setPage(1);
  }, [debouncedSearch, repId, typeFilter, quietOnly]);

  // Keep the URL in step so Back, refresh and a pasted link all agree.
  useEffect(() => {
    const qs = encodeListState(listState);
    const next = qs ? `/sales/clients?${qs}` : '/sales/clients';
    router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, typeFilter, quietOnly, page, repId]);

  const fetchClients = useCallback(() => {
    const seq = ++fetchCount.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (repId !== null) params.set('repId', String(repId));
    if (typeFilter) params.set('type', typeFilter);
    if (quietOnly) params.set('quiet', '1');

    fetch(`/api/sales/clients?${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ClientListResponse) => {
        if (seq !== fetchCount.current) return;
        setData(d);
      })
      .catch(() => { if (seq === fetchCount.current) setError('Failed to load your clients'); })
      .finally(() => { if (seq === fetchCount.current) setLoading(false); });
  }, [page, debouncedSearch, repId, typeFilter, quietOnly]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  // Restore where the rep was in the list, once the rows that make that
  // position meaningful are actually on the page.
  useEffect(() => {
    if (loading || restoredScroll.current) return;
    restoredScroll.current = true;
    const y = takeRememberedScroll();
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading]);

  const clients = data?.clients ?? [];
  const total = data?.total ?? 0;
  const quietCount = data?.quietCount ?? 0;
  const quietMonths = data?.quietAfterMonths ?? 3;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasAnySearch = debouncedSearch.length > 0;
  // A filtered-to-zero list must not read as "you have no clients".
  const hasAnyFilter = typeFilter !== '' || quietOnly;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Clients</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            {readOnly ? 'Viewing this rep’s client list (read-only)' : 'Your personal client list — notes, contact info, and their business with you'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {role === 'sales_manager' && (
            <RepSelector selectedRepId={repId} onSelect={setRepId} ownLabel="My Clients" />
          )}
          {/* Import/Export act on your own list only; disabled while viewing a rep's. */}
          {readOnly ? (
            <>
              <button disabled title="Available on your own list"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-300 cursor-not-allowed bg-white">
                <Upload className="h-4 w-4" /> Import CSV
              </button>
              <button disabled title="Available on your own list"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-300 cursor-not-allowed bg-white">
                <Download className="h-4 w-4" /> Export
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setShowFromTx(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:border-[#F26B2B]/50 hover:text-[#F26B2B] transition-colors">
                <Briefcase className="h-4 w-4" /> Add from transactions
              </button>
              <button onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:border-[#F26B2B]/50 hover:text-[#F26B2B] transition-colors">
                <Upload className="h-4 w-4" /> Import CSV
              </button>
              <a href="/api/sales/clients/export" download
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:border-[#F26B2B]/50 hover:text-[#F26B2B] transition-colors">
                <Download className="h-4 w-4" /> Export
              </a>
            </>
          )}
          {!readOnly && (
            <button onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] transition-colors">
              <Plus className="h-4 w-4" /> Add client
            </button>
          )}
        </div>
      </div>

      {/* Recent activity across all clients */}
      <RecentActivity
        repId={repId}
        refreshKey={activityKey}
        onOpenClient={(id) => { rememberScroll(window.scrollY); router.push(profileHref(id, listState)); }}
      />

      {/* Search + type filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by name, company, or email"
            className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          aria-label="Filter by client type"
          className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-900
                     focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] cursor-pointer"
        >
          <option value="">All types</option>
          {CRM_CLIENT_TYPES.map(t => (
            <option key={t} value={t}>{CRM_TYPE_LABEL_PLURAL[t]}</option>
          ))}
        </select>

        {/* Quiet summary doubles as the filter toggle. */}
        {quietCount > 0 && (
          <button
            onClick={() => setQuietOnly(v => !v)}
            aria-pressed={quietOnly}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm transition-colors ${
              quietOnly
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300 hover:text-amber-800'
            }`}
          >
            <Clock className="h-4 w-4" />
            {quietCount} gone quiet
          </button>
        )}
        {quietOnly && (
          <button onClick={() => setQuietOnly(false)}
            className="h-9 px-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : !loading && clients.length === 0 ? (
          hasAnySearch || hasAnyFilter ? (
            <EmptyState message={
              hasAnySearch
                ? `No clients match “${debouncedSearch}”`
                : quietOnly
                  ? 'No clients have gone quiet — nice.'
                  : 'No clients of that type yet'
            } />
          ) : (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">
                {readOnly ? 'This rep has no clients yet' : 'No clients yet'}
              </p>
              {!readOnly && (
                <>
                  <p className="text-sm text-[#6B7280] mt-1">
                    The quickest start: pull in the people you&rsquo;ve already done deals with.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                    <button onClick={() => setShowFromTx(true)}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] transition-colors">
                      <Briefcase className="h-4 w-4" /> Add from transactions
                    </button>
                    <button onClick={() => setShowAdd(true)}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:border-[#F26B2B]/50 hover:text-[#F26B2B] transition-colors">
                      <Plus className="h-4 w-4" /> Add manually
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Company</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Business</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Latest note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                  : clients.map(client => {
                    const biz = fmtBusinessIndicator(client.business ?? null);
                    return (
                      <tr key={client.id}
                        onClick={() => { rememberScroll(window.scrollY); router.push(profileHref(client.id, listState)); }}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* A real anchor so middle-click and copy-link work. */}
                            <Link
                              href={profileHref(client.id, listState)}
                              onClick={() => rememberScroll(window.scrollY)}
                              className="font-medium text-gray-900 hover:text-[#F26B2B] transition-colors"
                            >
                              {displayClientName(client.name, client.company)}
                            </Link>
                            <TypeBadge type={client.type} />
                          </div>
                          {/* Don't repeat the company when it is already standing in as the name. */}
                          {client.company && displayClientName(client.name, client.company) !== client.company && (
                            <p className="text-xs text-gray-500 sm:hidden">{client.company}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{client.company ?? '—'}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <p className="text-gray-700">{client.email ?? '—'}</p>
                          {client.phone && <p className="text-xs text-gray-500">{client.phone}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {biz ? (
                              <span className="inline-block text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-full px-2.5 py-1 whitespace-nowrap">
                                {biz}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                            {/* One signal per row, off the metrics engine. It
                                supersedes the old blanket "Quiet" pill, which
                                used the same 3-month rule for every client. */}
                            <SignalChip signal={client.signal} />
                          </div>
                          {client.lastOrderAt && (
                            <p className="text-xs text-gray-400 mt-1">
                              last {fmtLastOrder(client.lastOrderAt)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell max-w-[220px]">
                          {client.latestNote ? (
                            <p className="text-xs text-gray-500 truncate">{client.latestNote.body}</p>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {!error && total > PAGE_SIZE && (
          <Pagination current={page} total={totalPages} count={total} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </div>

      {/* Add / edit modal */}
      {(showAdd || editClient) && (
        <ClientFormModal
          client={editClient}
          onClose={() => { setShowAdd(false); setEditClient(null); }}
          onSaved={() => { setShowAdd(false); setEditClient(null); fetchClients(); setActivityKey(k => k + 1); }}
        />
      )}

      {/* Seed from the rep's own order history */}
      {showFromTx && (
        <AddFromTransactionsModal
          onClose={() => setShowFromTx(false)}
          onAdded={() => { fetchClients(); setActivityKey(k => k + 1); }}
        />
      )}

      {/* Import dialog */}
      {showImport && (
        <ImportClientsModal
          onClose={() => setShowImport(false)}
          onImported={() => { fetchClients(); setActivityKey(k => k + 1); }}
        />
      )}

    </div>
  );
}
