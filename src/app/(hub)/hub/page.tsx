'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CplModal } from '@/components/admin/hub/cpl-modal';
import { PrelimModal } from '@/components/admin/hub/prelim-modal';
import { ProposedInsuredModal } from '@/components/admin/hub/proposed-insured-modal';
import { NotesModal } from '@/components/admin/hub/notes-modal';
import { DetailModal } from '@/components/admin/hub/detail-modal';

interface Order {
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

interface QuickResult {
  id: number;
  fileNumber: string;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  operationalStatus: string | null;
}

type ModalType = 'cpl' | 'prelim' | 'proposed' | 'notes' | 'detail' | null;

const STATUS_OPTS = ['', 'open', 'in_process', 'closed', 'cancelled'];
const STATUS_LABELS: Record<string, string> = { open: 'Open', in_process: 'In Process', closed: 'Closed', cancelled: 'Cancelled' };
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const POLL_MS = 30_000;

export default function HubPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Quick search
  const [qsQuery, setQsQuery] = useState('');
  const [qsResults, setQsResults] = useState<QuickResult[]>([]);
  const [qsOpen, setQsOpen] = useState(false);
  const qsRef = useRef<HTMLDivElement>(null);
  const qsDebRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Modal
  const [modal, setModal] = useState<ModalType>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Prefetch form options on mount (cache for modals)
  useEffect(() => {
    fetch('/api/form-options').catch(() => {});
    fetch('/api/branches').catch(() => {});
  }, []);

  const fetchOrders = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    fetch(`/api/orders?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        setOrders(d.orders ?? []);
        setTotalPages(d.totalPages ?? 1);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, status, search]);

  useEffect(() => { setLoading(true); fetchOrders(); }, [fetchOrders]);

  // Polling
  useEffect(() => {
    const id = setInterval(fetchOrders, POLL_MS);
    return () => clearInterval(id);
  }, [fetchOrders]);

  // Quick search
  function handleQsInput(v: string) {
    setQsQuery(v);
    clearTimeout(qsDebRef.current);
    if (v.length < 2) { setQsResults([]); setQsOpen(false); return; }
    qsDebRef.current = setTimeout(() => {
      fetch(`/api/orders/quick-search?q=${encodeURIComponent(v)}`)
        .then((r) => r.ok ? r.json() : { results: [] })
        .then((d) => { setQsResults(d.results ?? []); setQsOpen(true); })
        .catch(() => {});
    }, 200);
  }

  useEffect(() => {
    function click(e: MouseEvent) { if (qsRef.current && !qsRef.current.contains(e.target as Node)) setQsOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  function openModal(order: Order, type: ModalType) {
    setSelectedOrder(order);
    setModal(type);
  }

  function closeModal() { setModal(null); }

  function handleStatusChange(v: string) { setStatus(v); setPage(1); }
  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(qsQuery);
    setQsOpen(false);
    setPage(1);
  }

  function addr(o: Order | QuickResult) {
    return [o.propertyStreet, o.propertyCity, o.propertyState].filter(Boolean).join(', ') || '—';
  }

  const selId = selectedOrder?.id ?? 0;
  const selFile = selectedOrder?.fileNumber ?? '';
  const selAddr = selectedOrder ? addr(selectedOrder) : '';

  return (
    <div className="flex flex-col h-full">
      {/* Quick Actions Bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
        <Link
          href="/orders/quick-entry"
          className="px-4 h-9 bg-[#C5A55A] text-white text-xs font-semibold rounded-lg hover:bg-[#B8953D] transition-colors inline-flex items-center gap-1.5"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          New Order
        </Link>

        <button
          onClick={() => { if (selectedOrder) openModal(selectedOrder, 'cpl'); }}
          disabled={!selectedOrder}
          className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Generate CPL
        </button>
        <button
          onClick={() => { if (selectedOrder) openModal(selectedOrder, 'proposed'); }}
          disabled={!selectedOrder}
          className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Proposed Insured
        </button>
        <button
          onClick={() => { if (selectedOrder) openModal(selectedOrder, 'prelim'); }}
          disabled={!selectedOrder}
          className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Find Prelim
        </button>

        <div className="flex-1" />

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="h-9 px-2 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#C5A55A]/30 outline-none"
        >
          <option value="">All Status</option>
          {STATUS_OPTS.filter(Boolean).map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
        </select>

        {/* Quick Search */}
        <div ref={qsRef} className="relative w-64">
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                value={qsQuery}
                onChange={(e) => handleQsInput(e.target.value)}
                onFocus={() => { if (qsQuery.length >= 2 && qsResults.length > 0) setQsOpen(true); }}
                placeholder="File # or address…"
                className="w-full h-9 pl-8 pr-3 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#C5A55A]/30 focus:border-[#C5A55A] outline-none"
              />
            </div>
          </form>
          {qsOpen && qsResults.length > 0 && (
            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {qsResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedOrder({ ...r, transactionType: null, openedAt: null });
                    setQsOpen(false);
                    setQsQuery(r.fileNumber);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                >
                  <span className="text-xs font-mono font-semibold text-[#1A1A2E]">{r.fileNumber}</span>
                  <span className="text-xs text-[#6B7280] ml-2">{addr(r)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Orders Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#F8F9FA] border-b border-gray-200 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider w-8" />
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">File #</th>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Address</th>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Client</th>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Status</th>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Type</th>
              <th className="text-left px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Opened</th>
              <th className="text-center px-3 py-2 font-semibold text-[#6B7280] uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-[#6B7280]">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[#6B7280]">No orders found.</td></tr>
            ) : orders.map((o) => {
              const isSelected = selectedOrder?.id === o.id;
              return (
                <tr
                  key={o.id}
                  onClick={() => setSelectedOrder(o)}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#C5A55A]/10' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-[#C5A55A]' : 'bg-transparent'}`} />
                  </td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-[#1A1A2E]">{o.fileNumber}</td>
                  <td className="px-3 py-1.5 text-[#1A1A2E] max-w-[260px] truncate">{addr(o)}</td>
                  <td className="px-3 py-1.5 text-[#4B5563] truncate max-w-[140px]">{o.clientName ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <StatusBadge status={o.operationalStatus} />
                  </td>
                  <td className="px-3 py-1.5 text-[#4B5563]">{o.transactionType ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[#4B5563] tabular-nums">{o.openedAt ? new Date(o.openedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <ActionBtn icon="cpl" title="CPL" onClick={() => openModal(o, 'cpl')} />
                      <ActionBtn icon="prelim" title="Prelim" onClick={() => openModal(o, 'prelim')} />
                      <ActionBtn icon="proposed" title="Proposed Insured" onClick={() => openModal(o, 'proposed')} />
                      <ActionBtn icon="notes" title="Notes" onClick={() => openModal(o, 'notes')} />
                      <ActionBtn icon="detail" title="Detail" onClick={() => openModal(o, 'detail')} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-white text-xs">
        <span className="text-[#6B7280]">{total} orders · Page {page}/{totalPages}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 h-7 border border-gray-200 rounded text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 h-7 border border-gray-200 rounded text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      {/* Modals */}
      <CplModal open={modal === 'cpl'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} />
      <PrelimModal open={modal === 'prelim'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} />
      <ProposedInsuredModal open={modal === 'proposed'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} />
      <NotesModal open={modal === 'notes'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} />
      <DetailModal open={modal === 'detail'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} />
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status?.toLowerCase() ?? '';
  const color = STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  const label = STATUS_LABELS[s] ?? status ?? '—';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${color}`}>
      {label}
    </span>
  );
}

function ActionBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded flex items-center justify-center text-[#6B7280] hover:bg-[#1B2A4A]/10 hover:text-[#1B2A4A] transition-colors"
    >
      {icon === 'cpl' && (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
      )}
      {icon === 'prelim' && (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
      )}
      {icon === 'proposed' && (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
      )}
      {icon === 'notes' && (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
      )}
      {icon === 'detail' && (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
      )}
    </button>
  );
}
