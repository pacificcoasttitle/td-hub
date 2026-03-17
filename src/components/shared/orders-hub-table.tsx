'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  CplModal, PrelimModal, ProposedInsuredModal, NotesModal, DetailModal,
} from '@/components/shared/action-modals';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface HubOrder {
  id: number;
  fileNumber: string;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  operationalStatus: string | null;
  transactionType: string | null;
  openedAt: string | null;
  clientName?: string | null;
}

export type ActionType = 'cpl' | 'prelim' | 'proposed' | 'notes' | 'detail' | 'fees';
type ModalType = 'cpl' | 'prelim' | 'proposed' | 'notes' | 'detail' | null;

export interface OrdersHubTableProps {
  fetchUrl: string;
  actions: ActionType[];
  compact?: boolean;
  accentColor?: string;
  isClient?: boolean;
  onOrderSelect?: (order: HubOrder) => void;
  showSearch?: boolean;
  showStatusFilter?: boolean;
  pageSize?: number;
  pollMs?: number;
  className?: string;
  feesHrefBuilder?: (orderId: number) => string;
}

/* ── Constants ─────────────────────────────────────────────────────────────── */

const STATUS_OPTS = ['', 'open', 'in_process', 'closed', 'cancelled'];
const STATUS_LABELS: Record<string, string> = { open: 'Open', in_process: 'In Process', closed: 'Closed', cancelled: 'Cancelled' };
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

/* ── Component ─────────────────────────────────────────────────────────────── */

export function OrdersHubTable({
  fetchUrl,
  actions,
  compact = false,
  accentColor = '#F26B2B',
  isClient = false,
  onOrderSelect,
  showSearch = true,
  showStatusFilter = true,
  pageSize = 25,
  pollMs = 0,
  className = '',
  feesHrefBuilder,
}: OrdersHubTableProps) {
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<ModalType>(null);
  const [selectedOrder, setSelectedOrder] = useState<HubOrder | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cellPy = compact ? 'py-2.5' : 'py-4';
  const textSz = compact ? 'text-sm' : 'text-base';
  const headPy = 'py-3';

  const fetchOrders = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const url = fetchUrl.includes('?') ? `${fetchUrl}&${params}` : `${fetchUrl}?${params}`;
    fetch(url)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        setOrders(d.orders ?? []);
        setTotalPages(d.totalPages ?? 1);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchUrl, page, pageSize, status, search]);

  useEffect(() => { setLoading(true); fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    const id = setInterval(fetchOrders, pollMs);
    return () => clearInterval(id);
  }, [fetchOrders, pollMs]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function handleSearchInput(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 400);
  }

  function selectOrder(o: HubOrder) {
    setSelectedOrder(o);
    onOrderSelect?.(o);
  }

  function openModal(o: HubOrder, type: ModalType) {
    setSelectedOrder(o);
    onOrderSelect?.(o);
    setModal(type);
  }

  function closeModal() { setModal(null); }

  function addr(o: HubOrder) {
    return [o.propertyStreet, o.propertyCity, o.propertyState].filter(Boolean).join(', ') || '—';
  }

  const selId = selectedOrder?.id ?? 0;
  const selFile = selectedOrder?.fileNumber ?? '';
  const selAddr = selectedOrder ? addr(selectedOrder) : '';
  const hasActions = actions.length > 0;
  const colCount = (compact ? 8 : 7) + (hasActions ? 1 : 0);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar */}
      {(showSearch || showStatusFilter) && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
          {showStatusFilter && (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
              <option value="">All Status</option>
              {STATUS_OPTS.filter(Boolean).map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
            </select>
          )}
          {showSearch && (
            <form onSubmit={handleSearchSubmit} className="flex-1 max-w-xs ml-auto relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" value={searchInput} onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="File # or address…"
                className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20" />
            </form>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className={`w-full ${textSz}`}>
          <thead className="sticky top-0 bg-[#F8F9FA] border-b border-gray-200 z-10">
            <tr>
              {compact && <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs w-8`} />}
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>File #</th>
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Address</th>
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Client</th>
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Status</th>
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Type</th>
              <th className={`text-left px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Opened</th>
              {hasActions && <th className={`text-center px-4 ${headPy} font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="text-center py-12 text-[#6B7280]">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={colCount} className="text-center py-12 text-[#6B7280]">No orders found.</td></tr>
            ) : orders.map((o) => {
              const isSel = selectedOrder?.id === o.id;
              return (
                <tr key={o.id} onClick={() => selectOrder(o)}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${isSel ? 'bg-[#F26B2B]/8' : 'hover:bg-gray-50'}`}>
                  {compact && (
                    <td className={`px-4 ${cellPy}`}>
                      <div className={`w-2.5 h-2.5 rounded-full ${isSel ? 'bg-[#F26B2B]' : 'bg-transparent'}`} />
                    </td>
                  )}
                  <td className={`px-4 ${cellPy} font-mono font-medium text-[#1A1A2E]`}>{o.fileNumber}</td>
                  <td className={`px-4 ${cellPy} text-[#1A1A2E] max-w-[300px]`}>{addr(o)}</td>
                  <td className={`px-4 ${cellPy} text-[#4B5563] max-w-[160px] truncate`}>{o.clientName ?? '—'}</td>
                  <td className={`px-4 ${cellPy}`}><StatusBadge status={o.operationalStatus} /></td>
                  <td className={`px-4 ${cellPy} text-[#4B5563]`}>{o.transactionType ?? '—'}</td>
                  <td className={`px-4 ${cellPy} text-[#4B5563] tabular-nums`}>{o.openedAt ? new Date(o.openedAt).toLocaleDateString() : '—'}</td>
                  {hasActions && (
                    <td className={`px-4 ${cellPy}`}>
                      <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {actions.includes('cpl') && <ActionBtn icon="cpl" title="CPL" onClick={() => openModal(o, 'cpl')} />}
                        {actions.includes('prelim') && <ActionBtn icon="prelim" title="Prelim" onClick={() => openModal(o, 'prelim')} />}
                        {actions.includes('proposed') && <ActionBtn icon="proposed" title="Proposed Insured" onClick={() => openModal(o, 'proposed')} />}
                        {actions.includes('notes') && <ActionBtn icon="notes" title="Notes" onClick={() => openModal(o, 'notes')} />}
                        {actions.includes('fees') && feesHrefBuilder && (
                          <Link href={feesHrefBuilder(o.id)} className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-[#F26B2B]/10 hover:text-[#F26B2B] transition-colors" title="Fees">
                            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </Link>
                        )}
                        {actions.includes('detail') && <ActionBtn icon="detail" title="Detail" onClick={() => openModal(o, 'detail')} />}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-white text-sm">
          <span className="text-[#6B7280]">{total} orders · Page {page}/{totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 h-8 border border-gray-200 rounded-md text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors">Prev</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 h-8 border border-gray-200 rounded-md text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors">Next</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {actions.includes('cpl') && (
        <CplModal open={modal === 'cpl'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />
      )}
      {actions.includes('prelim') && (
        <PrelimModal open={modal === 'prelim'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />
      )}
      {actions.includes('proposed') && (
        <ProposedInsuredModal open={modal === 'proposed'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} accentColor={accentColor} />
      )}
      {actions.includes('notes') && (
        <NotesModal open={modal === 'notes'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />
      )}
      {actions.includes('detail') && (
        <DetailModal open={modal === 'detail'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string | null }) {
  const s = status?.toLowerCase() ?? '';
  const color = STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  const label = STATUS_LABELS[s] ?? status ?? '—';
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium border ${color}`}>{label}</span>;
}

function ActionBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-[#F26B2B]/10 hover:text-[#F26B2B] transition-colors">
      {icon === 'cpl' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
      {icon === 'prelim' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
      {icon === 'proposed' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
      {icon === 'notes' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>}
      {icon === 'detail' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
    </button>
  );
}
