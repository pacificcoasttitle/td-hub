'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { RepSelector } from '../rep-selector';
import { SkeletonRow, EmptyState, ErrorBlock, Pagination } from '@/components/admin/shared-table';
import { ClientFormModal } from './client-form-modal';
import { ClientDetailDrawer } from './client-detail-drawer';
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

interface Props {
  role: 'sales_rep' | 'sales_manager';
}

export function ClientsPageClient({ role }: Props) {
  const [repId, setRepId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [data, setData] = useState<ClientListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editClient, setEditClient] = useState<CrmClient | null>(null);
  const [openClientId, setOpenClientId] = useState<number | null>(null);
  const fetchCount = useRef(0);

  // A manager looking at a rep's list is a guest: read-only (spec §5/§9).
  const readOnly = role === 'sales_manager' && repId !== null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [debouncedSearch, repId]);

  const fetchClients = useCallback(() => {
    const seq = ++fetchCount.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (repId !== null) params.set('repId', String(repId));

    fetch(`/api/sales/clients?${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ClientListResponse) => {
        if (seq !== fetchCount.current) return;
        setData(d);
      })
      .catch(() => { if (seq === fetchCount.current) setError('Failed to load your clients'); })
      .finally(() => { if (seq === fetchCount.current) setLoading(false); });
  }, [page, debouncedSearch, repId]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const clients = data?.clients ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasAnySearch = debouncedSearch.length > 0;

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
          {/* Import/Export ship in the next release — rendered so the layout is final. */}
          <button disabled title="Coming soon"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-300 cursor-not-allowed bg-white">
            <Upload className="h-4 w-4" /> Import CSV
          </button>
          <button disabled title="Coming soon"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-300 cursor-not-allowed bg-white">
            <Download className="h-4 w-4" /> Export
          </button>
          {!readOnly && (
            <button onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] transition-colors">
              <Plus className="h-4 w-4" /> Add client
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by name, company, or email"
          className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm bg-white
                     focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {error ? (
          <ErrorBlock message={error} />
        ) : !loading && clients.length === 0 ? (
          hasAnySearch ? (
            <EmptyState message={`No clients match “${debouncedSearch}”`} />
          ) : (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">
                {readOnly ? 'This rep has no clients yet' : 'No clients yet'}
              </p>
              {!readOnly && (
                <>
                  <p className="text-sm text-[#6B7280] mt-1">
                    Add your first client or import a list to get started.
                  </p>
                  <button onClick={() => setShowAdd(true)}
                    className="mt-4 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] transition-colors">
                    <Plus className="h-4 w-4" /> Add your first client
                  </button>
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
                        onClick={() => setOpenClientId(client.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{client.name}</p>
                          <p className="text-xs text-gray-500 sm:hidden">{client.company ?? ''}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{client.company ?? '—'}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <p className="text-gray-700">{client.email ?? '—'}</p>
                          {client.phone && <p className="text-xs text-gray-500">{client.phone}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {biz ? (
                            <span className="inline-block text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-full px-2.5 py-1 whitespace-nowrap">
                              {biz}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
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
          onSaved={() => { setShowAdd(false); setEditClient(null); fetchClients(); }}
        />
      )}

      {/* Detail drawer */}
      {openClientId !== null && (
        <ClientDetailDrawer
          clientId={openClientId}
          repId={repId}
          onClose={() => setOpenClientId(null)}
          onEdit={(client) => { setOpenClientId(null); setEditClient(client); }}
          onChanged={fetchClients}
        />
      )}
    </div>
  );
}
