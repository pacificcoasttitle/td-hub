'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  CplModal, PrelimModal, ProposedInsuredModal, NotesModal, DetailModal, DeliverPrelimModal,
} from '@/components/shared/action-modals';
import { TH, StatusBadge, DocBadges, ActionsDropdown } from './orders-hub-parts';
import type { OrderDocuments } from './orders-hub-parts';
import { createdByVariant, formatCreatedBy } from '@/lib/domain/orders/created-by-display';
import { formatOrderDate } from '@/lib/domain/orders/date-format';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';
import { STATUS_FILTER_OPTIONS } from '@/lib/domain/orders/status-format';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type { OrderDocuments };

export interface HubOrder {
  id: number;
  fileNumber: string;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip?: string | null;
  operationalStatus: string | null;
  softproStatus?: string | null;
  transactionType: string | null;
  type?: string | null;
  openedAt: string | null;
  branchId?: number | null;
  clientContactId?: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientCompany?: string | null;
  openedBy?: string | null;
  createdByName?: string | null;
  documents?: OrderDocuments;
  escrowOfficerId?: number | null;
  escrowOfficerName?: string | null;
}

export type ActionType = 'cpl' | 'prelim' | 'deliver_prelim' | 'proposed' | 'notes' | 'detail' | 'fees' | 'resync' | 'retry_tp';
type ModalType = 'cpl' | 'prelim' | 'deliver_prelim' | 'proposed' | 'notes' | 'detail' | null;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

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
  showCheckboxes?: boolean;
  onSelectedOrdersChange?: (orders: HubOrder[]) => void;
  externalSearch?: string;
  externalStatus?: string;
  onAction?: (type: ActionType, order: HubOrder) => void;
  showEscrowOfficerColumn?: boolean;
  /** Bump to force a table refetch (e.g. after external modal success on hub page). */
  refreshSignal?: number;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function OrdersHubTable({
  fetchUrl, actions, compact = false, accentColor = '#F26B2B', isClient = false,
  onOrderSelect, showSearch = true, showStatusFilter = true,
  pageSize = 25, pollMs = 0, className = '', feesHrefBuilder,
  showCheckboxes = false, onSelectedOrdersChange, externalSearch, externalStatus, onAction,
  showEscrowOfficerColumn = false, refreshSignal = 0,
}: OrdersHubTableProps) {
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [page, setPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [internalSearch, setInternalSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [internalStatus, setInternalStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedMap, setSelectedMap] = useState<Map<number, HubOrder>>(new Map());
  const [activityMap, setActivityMap] = useState<Map<number, string>>(new Map());

  const [modal, setModal] = useState<ModalType>(null);
  const [modalOrder, setModalOrder] = useState<HubOrder | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activityFetched = useRef(false);

  const search = externalSearch ?? internalSearch;
  const status = externalStatus ?? internalStatus;
  const cellPy = compact ? 'py-2.5' : 'py-4';
  const textSz = compact ? 'text-sm' : 'text-base';
  const hasActions = actions.length > 0;
  const showToolbar = (showSearch && externalSearch === undefined) || (showStatusFilter && externalStatus === undefined);

  const fetchOrders = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page), pageSize: String(currentPageSize),
      sortBy: 'openedAt', sortDir: 'desc',
    });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const url = fetchUrl.includes('?') ? `${fetchUrl}&${params}` : `${fetchUrl}?${params}`;
    fetch(url)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const next: HubOrder[] = d.orders ?? [];
        setOrders(next);
        setTotalPages(d.totalPages ?? 1);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchUrl, page, currentPageSize, status, search]);

  useEffect(() => {
    queueMicrotask(() => setLoading(true));
    fetchOrders();
  }, [fetchOrders]);
  useEffect(() => {
    if (!refreshSignal) return;
    fetchOrders();
  }, [refreshSignal, fetchOrders]);
  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    const id = setInterval(() => { if (!document.hidden) fetchOrders(); }, pollMs);
    return () => clearInterval(id);
  }, [fetchOrders, pollMs]);

  useEffect(() => {
    if (isClient || activityFetched.current) return;
    activityFetched.current = true;
    fetch('/api/orders/recent-activity')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.activity) return;
        const m = new Map<number, string>();
        for (const a of d.activity as Array<{ orderId: number; description: string }>) m.set(a.orderId, a.description);
        setActivityMap(m);
      })
      .catch(() => {});
  }, [isClient]);

  useEffect(() => {
    queueMicrotask(() => setPage(1));
  }, [fetchUrl]);

  useEffect(() => {
    queueMicrotask(() => {
      setCurrentPageSize(pageSize);
      setPage(1);
    });
  }, [pageSize]);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedMap(new Map());
      onSelectedOrdersChange?.([]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, fetchUrl]);

  function handleSearchInput(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setInternalSearch(v); setPage(1); }, 400);
  }

  function toggleCheck(order: HubOrder) {
    const next = new Map(selectedMap);
    if (next.has(order.id)) next.delete(order.id); else next.set(order.id, order);
    setSelectedMap(next);
    onSelectedOrdersChange?.(Array.from(next.values()));
  }

  function toggleAll() {
    const allSelected = orders.length > 0 && orders.every(o => selectedMap.has(o.id));
    const next = new Map(selectedMap);
    if (allSelected) { orders.forEach(o => next.delete(o.id)); }
    else { orders.forEach(o => next.set(o.id, o)); }
    setSelectedMap(next);
    onSelectedOrdersChange?.(Array.from(next.values()));
  }

  function handleRowAction(order: HubOrder, type: ModalType) {
    if (onAction && type) { onAction(type as ActionType, order); return; }
    setModalOrder(order); setModal(type);
  }

  function closeModal() { setModal(null); }

  function addr(o: HubOrder) {
    return formatOrderAddress({
      propertyStreet: o.propertyStreet,
      propertyCity: o.propertyCity,
      propertyState: o.propertyState,
      propertyZip: o.propertyZip,
    });
  }

  const selId = modalOrder?.id ?? 0;
  const selFile = modalOrder?.fileNumber ?? '';
  const selAddr = modalOrder ? addr(modalOrder) : '';
  const allOnPage = orders.length > 0 && orders.every(o => selectedMap.has(o.id));
  const someOnPage = orders.some(o => selectedMap.has(o.id));

  const colCount = (showCheckboxes ? 1 : 0) + 8 + (showEscrowOfficerColumn ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Internal Toolbar — only shown when hub doesn't control search/status */}
      {showToolbar && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
          {showStatusFilter && externalStatus === undefined && (
            <select value={internalStatus} onChange={(e) => { setInternalStatus(e.target.value); setPage(1); }}
              className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20">
              <option value="">All Status</option>
              {STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
          {showSearch && externalSearch === undefined && (
            <form onSubmit={(e) => { e.preventDefault(); setInternalSearch(searchInput); setPage(1); }} className="flex-1 max-w-xs ml-auto relative">
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
              {showCheckboxes && (
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" checked={allOnPage}
                    ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPage; }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded accent-[#F26B2B] cursor-pointer" />
                </th>
              )}
              <TH>File #</TH>
              <TH>Address</TH>
              <TH>Client</TH>
              <TH>Status</TH>
              <TH>Type</TH>
              {showEscrowOfficerColumn && <TH>Escrow Officer</TH>}
              <TH>Opened</TH>
              <TH>Created By</TH>
              {hasActions && <TH center>Actions</TH>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="text-center py-12 text-[#6B7280]">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={colCount} className="text-center py-12 text-[#6B7280]">No orders found.</td></tr>
            ) : orders.map((o) => {
              const checked = selectedMap.has(o.id);
              const createdByDisplay = formatCreatedBy(o.createdByName);
              const createdByClass = createdByVariant(o.createdByName) === 'system'
                ? 'text-[#9CA3AF] italic'
                : 'text-[#4B5563]';
              return (
                <tr key={o.id}
                  onClick={() => { if (showCheckboxes) toggleCheck(o); else { onOrderSelect?.(o); } }}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${checked ? 'bg-[#F26B2B]/8' : 'hover:bg-gray-50'}`}>
                  {showCheckboxes && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCheck(o)}
                        className="w-4 h-4 rounded accent-[#F26B2B] cursor-pointer" />
                    </td>
                  )}
                  <td className={`px-4 ${cellPy} font-mono font-medium text-[#1A1A2E] whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-1.5">
                      {o.fileNumber}
                      {activityMap.has(o.id) && (
                        <span className="w-2 h-2 rounded-full bg-[#F26B2B] shrink-0" title={`New activity: ${activityMap.get(o.id)}`} />
                      )}
                      <DocBadges docs={o.documents} />
                    </span>
                  </td>
                  <td className={`px-4 ${cellPy} text-[#1A1A2E] max-w-[300px]`}>{addr(o)}</td>
                  <td className={`px-4 ${cellPy} max-w-[200px]`}>
                    {o.clientName ? (
                      <div className="min-w-0">
                        <div className="text-sm text-[#1A1A2E] truncate" title={o.clientName}>{o.clientName}</div>
                        {o.clientCompany && (
                          <div className="text-xs text-[#6B7280] truncate" title={o.clientCompany}>{o.clientCompany}</div>
                        )}
                      </div>
                    ) : o.clientCompany ? (
                      <div className="text-sm text-[#1A1A2E] truncate" title={o.clientCompany}>{o.clientCompany}</div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className={`px-4 ${cellPy}`}><StatusBadge status={o.operationalStatus} /></td>
                  <td className={`px-4 ${cellPy} text-[#4B5563] capitalize`}>{(o.type ?? o.transactionType)?.replace(/_/g, ' ') ?? '—'}</td>
                  {showEscrowOfficerColumn && (
                    <td className={`px-4 ${cellPy} whitespace-nowrap`}>
                      {o.escrowOfficerName
                        ? <span className="text-[#1A1A2E]">{o.escrowOfficerName}</span>
                        : <span className="text-red-600 font-medium">Unassigned</span>}
                    </td>
                  )}
                  <td className={`px-4 ${cellPy} text-[#4B5563] tabular-nums whitespace-nowrap`}>{formatOrderDate(o.openedAt)}</td>
                  <td className={`px-4 ${cellPy} whitespace-nowrap ${createdByClass}`}>{createdByDisplay}</td>
                  {hasActions && (
                    <td className={`px-4 ${cellPy}`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center">
                        <ActionsDropdown
                          orderId={o.id}
                          hasProperty={!!(o.propertyStreet || o.propertyCity)}
                          softproStatus={o.softproStatus}
                          operationalStatus={o.operationalStatus}
                          documents={o.documents}
                          actions={actions}
                          isClient={isClient}
                          onOpenModal={(type) => handleRowAction(o, type as ModalType)}
                          feesHref={feesHrefBuilder ? feesHrefBuilder(o.id) : undefined}
                          onRefresh={fetchOrders}
                        />
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
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-white text-sm">
        <div className="flex items-center gap-3">
          <span className="text-[#6B7280]">
            {total} orders
            {selectedMap.size > 0 && <> · <span className="text-[#F26B2B] font-medium">{selectedMap.size} selected</span></>}
          </span>
          <label className="inline-flex items-center gap-1.5 text-xs text-[#6B7280]">
            Show
            <select
              value={currentPageSize}
              onChange={(e) => {
                setCurrentPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 px-2 border border-gray-200 rounded-md text-xs bg-white text-[#1A1A2E] outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20"
            >
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            per page
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 h-8 border border-gray-200 rounded-md text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors text-xs font-medium">‹ Prev</button>
          <span className="text-xs text-[#6B7280]">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 h-8 border border-gray-200 rounded-md text-[#4B5563] hover:bg-gray-50 disabled:opacity-30 transition-colors text-xs font-medium">Next ›</button>
        </div>
      </div>

      {/* Internal Modals — only when onAction is not provided */}
      {!onAction && (
        <>
          {actions.includes('cpl') && <CplModal open={modal === 'cpl'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} onSuccess={fetchOrders} />}
          {actions.includes('prelim') && <PrelimModal open={modal === 'prelim'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />}
          {actions.includes('deliver_prelim') && <DeliverPrelimModal open={modal === 'deliver_prelim'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} accentColor={accentColor} onSuccess={fetchOrders} />}
          {actions.includes('proposed') && <ProposedInsuredModal open={modal === 'proposed'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} onSuccess={fetchOrders} />}
          {actions.includes('notes') && <NotesModal open={modal === 'notes'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />}
          {actions.includes('detail') && <DetailModal open={modal === 'detail'} onClose={closeModal} orderId={selId} fileNumber={selFile} address={selAddr} isClient={isClient} accentColor={accentColor} />}
        </>
      )}
    </div>
  );
}

