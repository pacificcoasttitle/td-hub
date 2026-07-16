'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OrdersHubTable, type HubOrder, type ActionType } from '@/components/shared/orders-hub-table';
import { CplModal } from '@/components/shared/action-modals/cpl-modal';
import { PrelimModal } from '@/components/shared/action-modals/prelim-modal';
import { ProposedInsuredModal } from '@/components/shared/action-modals/proposed-insured-modal';
import { NotesModal } from '@/components/shared/action-modals/notes-modal';
import { DetailModal } from '@/components/shared/action-modals/detail-modal';
import { DeliverPrelimModal } from '@/components/shared/action-modals/deliver-prelim-modal';
import { BatchProcessModal, type BatchResult } from '@/components/shared/batch-process-modal';
import { QuickActionButton } from '@/components/admin/hub/quick-action-button';
import { EscrowTaskCards } from '@/components/escrow/escrow-task-cards';
import {
  OfficerFilterChips,
  type OfficerFilterValue,
} from '@/components/escrow/officer-filter-chips';
import type { TaskPriority } from '@/lib/domain/escrow/tasks';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';
import { STATUS_FILTER_OPTIONS } from '@/lib/domain/orders/status-format';

interface QuickResult { id: number; fileNumber: string; propertyStreet: string | null; propertyCity: string | null; propertyState: string | null; operationalStatus: string | null; }
type ModalType = 'cpl' | 'prelim' | 'deliver_prelim' | 'proposed' | 'notes' | 'detail' | null;

function oAddr(o: HubOrder | QuickResult) {
  return formatOrderAddress({
    propertyStreet: o.propertyStreet,
    propertyCity: o.propertyCity,
    propertyState: o.propertyState,
  });
}

export default function HubPage() {
  const router = useRouter();
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

  // ─── Role-aware state (escrow_assistant gets task cards + officer chips) ───
  const [role, setRole] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const [officerFilter, setOfficerFilter] = useState<OfficerFilterValue>(null);

  useEffect(() => {
    if (role !== 'escrow_assistant') {
      queueMicrotask(() => {
        setPriorityFilter(null);
        setOfficerFilter(null);
      });
    }
  }, [role]);

  useEffect(() => {
    fetch('/api/form-options').catch(() => {});
    fetch('/api/branches').catch(() => {});
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { role?: string } | null) => { if (d?.role) setRole(d.role); })
      .catch(() => {});
  }, []);

  const isEscrowAssistant = role === 'escrow_assistant';

  const ordersFetchUrl = useMemo(() => {
    let base = '/api/orders';
    const params = new URLSearchParams();
    if (priorityFilter !== null && isEscrowAssistant) {
      params.set('priority', String(priorityFilter));
    }
    if (officerFilter === 'unassigned' && isEscrowAssistant) {
      params.set('escrowOfficerId', 'null');
    } else if (typeof officerFilter === 'number' && isEscrowAssistant) {
      params.set('escrowOfficerId', String(officerFilter));
    }
    const qs = params.toString();
    if (qs) base = `${base}?${qs}`;
    return base;
  }, [priorityFilter, officerFilter, isEscrowAssistant]);

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

        <QuickActionButton label="Generate CPL" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('cpl')} />
        <QuickActionButton label="Proposed Insured" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('proposed')} />
        <QuickActionButton label="Find Prelim" count={selCount} disabled={selCount === 0} onClick={() => handleQuickAction('prelim')} />

        <div className="flex-1" />

        {/* Status Filter */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-2 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:border-[#F26B2B] shrink-0">
          <option value="">All Status</option>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
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
                  setQsOpen(false); router.push(`/orders/${r.id}`);
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

      {/* ─── Escrow Assistant signals (cards + officer chips) ─── */}
      {isEscrowAssistant && (
        <>
          <EscrowTaskCards
            activeFilter={priorityFilter}
            onFilterChange={setPriorityFilter}
          />
          <OfficerFilterChips
            activeOfficerId={officerFilter}
            onChange={setOfficerFilter}
          />
        </>
      )}

      {/* ─── Orders Table (checkboxes, no internal search/status) ─── */}
      <OrdersHubTable
        fetchUrl={ordersFetchUrl}
        actions={['cpl', 'proposed', 'prelim', 'deliver_prelim', 'notes', 'detail', 'retry_tp', 'resync']}
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
        showEscrowOfficerColumn={isEscrowAssistant}
      />

      {/* ─── Single-Order Modals (opened from row actions or single-select quick action) ─── */}
      <CplModal open={modal === 'cpl'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <PrelimModal open={modal === 'prelim'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <DeliverPrelimModal open={modal === 'deliver_prelim'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <ProposedInsuredModal open={modal === 'proposed'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <NotesModal open={modal === 'notes'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />
      <DetailModal open={modal === 'detail'} onClose={() => setModal(null)} orderId={mId} fileNumber={mFile} address={mAddr} />

      {/* ─── Batch Processing Modal ─── */}
      {batchState && (
        <BatchProcessModal state={batchState} onClose={() => setBatchState(null)} />
      )}
    </div>
  );
}

