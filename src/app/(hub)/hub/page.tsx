'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { OrdersHubTable, type HubOrder, type ActionType } from '@/components/shared/orders-hub-table';
import { CplModal } from '@/components/shared/action-modals/cpl-modal';
import { PrelimModal } from '@/components/shared/action-modals/prelim-modal';
import { ProposedInsuredModal } from '@/components/shared/action-modals/proposed-insured-modal';
import { NotesModal } from '@/components/shared/action-modals/notes-modal';
import { DetailModal } from '@/components/shared/action-modals/detail-modal';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';

interface QuickResult { id: number; fileNumber: string; propertyStreet: string | null; propertyCity: string | null; propertyState: string | null; operationalStatus: string | null; }
type ModalType = 'cpl' | 'prelim' | 'proposed' | 'notes' | 'detail' | null;
interface BatchResult { order: HubOrder; ok: boolean; error?: string; }

function oAddr(o: HubOrder | QuickResult) {
  return [o.propertyStreet, o.propertyCity, o.propertyState].filter(Boolean).join(', ') || '—';
}

export default function HubPage() {
  const [selectedOrders, setSelectedOrders] = useState<HubOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [qsResults, setQsResults] = useState<QuickResult[]>([]);
  const [qsOpen, setQsOpen] = useState(false);
  const qsRef = useRef<HTMLDivElement>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [modal, setModal] = useState<ModalType>(null);
  const [modalOrder, setModalOrder] = useState<HubOrder | null>(null);
  const [batchState, setBatchState] = useState<{ type: string; orders: HubOrder[]; current: number; results: BatchResult[] } | null>(null);

  useEffect(() => {
    fetch('/api/form-options').catch(() => {});
    fetch('/api/branches').catch(() => {});
  }, []);

  function handleSearchInput(v: string) {
    setSearchQuery(v);
    clearTimeout(debRef.current);
    if (v.length < 2) { setQsResults([]); setQsOpen(false); return; }
    debRef.current = setTimeout(() => {
      fetch(`/api/orders/quick-search?q=${encodeURIComponent(v)}`)
        .then((r) => r.ok ? r.json() : { results: [] })
        .then((d) => { setQsResults(d.results ?? []); setQsOpen(true); })
        .catch(() => {});
    }, 200);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTableSearch(searchQuery);
    setQsOpen(false);
  }

  function clearSearch() {
    setSearchQuery(''); setTableSearch(''); setQsResults([]); setQsOpen(false);
  }

  useEffect(() => {
    function click(e: MouseEvent) { if (qsRef.current && !qsRef.current.contains(e.target as Node)) setQsOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  function openModalForOrder(type: ModalType, order: HubOrder) {
    setModalOrder(order); setModal(type);
  }

  const handleRowAction = useCallback((type: ActionType, order: HubOrder) => {
    openModalForOrder(type as ModalType, order);
  }, []);

  function handleQuickAction(type: 'cpl' | 'proposed' | 'prelim') {
    if (selectedOrders.length === 0) return;
    if (selectedOrders.length === 1) {
      openModalForOrder(type, selectedOrders[0]);
    } else {
      runBatch(type, selectedOrders);
    }
  }

  async function runBatch(type: string, orders: HubOrder[]) {
    setBatchState({ type, orders, current: 0, results: [] });
    const results: BatchResult[] = [];
    for (let i = 0; i < orders.length; i++) {
      setBatchState((s) => s ? { ...s, current: i + 1 } : null);
      try {
        const url = type === 'cpl'
          ? '/api/vendor-actions/cpl'
          : type === 'proposed'
            ? `/api/orders/${orders[i].id}/proposed-insured`
            : `/api/orders/${orders[i].id}/fetch-prelim`;
        const body = type === 'cpl' ? JSON.stringify({ orderId: orders[i].id, underwriter: 'westcor' }) : undefined;
        const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : {}, body });
        const data = await res.json();
        if (!res.ok || (type !== 'prelim' && !data.success)) throw new Error(data.error ?? 'Failed');
        results.push({ order: orders[i], ok: true });
      } catch (err) {
        results.push({ order: orders[i], ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
      setBatchState((s) => s ? { ...s, results: [...results] } : null);
    }
  }

  const selCount = selectedOrders.length;
  const mId = modalOrder?.id ?? 0;
  const mFile = modalOrder?.fileNumber ?? '';
  const mAddr = modalOrder ? oAddr(modalOrder) : '';

  return (
    <div className="flex flex-col h-full">
      {/* ─── Quick Actions Bar ─── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 shrink-0">
        <Link href="/hub/new-order"
          className="px-4 h-9 bg-[#F26B2B] text-white text-xs font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors inline-flex items-center gap-1.5 shrink-0">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          New Order
        </Link>

        <QAButton label="Generate CPL" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('cpl')} />
        <QAButton label="Proposed Insured" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('proposed')} />
        <QAButton label="Find Prelim" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('prelim')} />

        <div className="flex-1" />

        {/* Status Filter */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-2 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:border-[#F26B2B] shrink-0">
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_process">In Process</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {/* Single Search Bar */}
        <div ref={qsRef} className="relative w-72 shrink-0">
          <form onSubmit={handleSearchSubmit} className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => { if (searchQuery.length >= 2 && qsResults.length > 0) setQsOpen(true); }}
              placeholder="Search by file #, address, or client…"
              className="w-full h-9 pl-9 pr-8 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B] outline-none" />
            {searchQuery && (
              <button type="button" onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563] p-0.5">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </form>
          {qsOpen && qsResults.length > 0 && (
            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {qsResults.map((r) => (
                <button key={r.id} onClick={() => {
                  setSearchQuery(r.fileNumber); setTableSearch(r.fileNumber); setQsOpen(false);
                }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                  <span className="text-xs font-mono font-semibold text-[#1A1A2E]">{r.fileNumber}</span>
                  <span className="text-xs text-[#6B7280] ml-2">{oAddr(r)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Orders Table (checkboxes, no internal search/status) ─── */}
      <OrdersHubTable
        fetchUrl="/api/orders"
        actions={['cpl', 'prelim', 'proposed', 'notes', 'detail']}
        compact
        accentColor="#F26B2B"
        showSearch={false}
        showStatusFilter={false}
        showCheckboxes
        externalSearch={tableSearch}
        externalStatus={statusFilter}
        onSelectedOrdersChange={setSelectedOrders}
        onAction={handleRowAction}
        pageSize={25}
        pollMs={30_000}
        className="flex-1 min-h-0"
      />

      {/* ─── Single-Order Modals (opened from row actions or single-select quick action) ─── */}
      <CplModal open={modal === 'cpl'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <PrelimModal open={modal === 'prelim'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <ProposedInsuredModal open={modal === 'proposed'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <NotesModal open={modal === 'notes'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <DetailModal open={modal === 'detail'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />

      {/* ─── Batch Processing Modal ─── */}
      {batchState && (
        <ModalShell open onClose={() => setBatchState(null)}
          title={`Batch ${batchState.type === 'cpl' ? 'CPL' : batchState.type === 'proposed' ? 'Proposed Insured' : 'Prelim Check'}`}
          subtitle={`${batchState.orders.length} orders`}>
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-[#F26B2B] rounded-full transition-all" style={{ width: `${(batchState.current / batchState.orders.length) * 100}%` }} />
              </div>
              <span className="text-xs text-[#6B7280] shrink-0 tabular-nums">{batchState.current}/{batchState.orders.length}</span>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {batchState.orders.map((o, i) => {
                const r = batchState.results[i];
                return (
                  <div key={o.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 text-sm">
                    {r ? (
                      r.ok
                        ? <svg className="h-4 w-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    ) : i < batchState.current ? (
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                    )}
                    <span className="font-mono text-xs font-medium text-[#1A1A2E]">{o.fileNumber}</span>
                    <span className="text-xs text-[#6B7280] truncate">{oAddr(o)}</span>
                    {r && !r.ok && <span className="text-[10px] text-red-500 ml-auto shrink-0">{r.error}</span>}
                  </div>
                );
              })}
            </div>
            {batchState.current === batchState.orders.length && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-sm text-[#1A1A2E] font-medium">
                  {batchState.results.filter(r => r.ok).length}/{batchState.orders.length} succeeded
                </p>
                <button onClick={() => setBatchState(null)} className="mt-3 w-full h-10 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors">
                  Done
                </button>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function QAButton({ label, count, disabled, onClick }: { label: string; count: number; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5 shrink-0">
      {label}
      {count > 0 && (
        <span className="bg-[#F26B2B] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
          {count}
        </span>
      )}
    </button>
  );
}
