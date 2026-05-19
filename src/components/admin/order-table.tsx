'use client';

import { useState, useCallback } from 'react';
import { OrderDetailsModal } from './OrderDetailsModal';
import { ConfirmationsModal } from './ConfirmationsModal';
import {
  type OrderProperty,
  ActionsDropdown, SkeletonRow, PagBtn,
  formatAddress, buildPageRange,
} from './order-table-parts';
import { createdByVariant, formatCreatedBy } from '@/lib/domain/orders/created-by-display';

export interface Order {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  productType?: string | null;
  salesRepId: number | null;
  salesRepName?: string | null;
  createdByName?: string | null;
  source?: string | null;
  emailStatus?: string | null;
  dupOverride?: boolean | null;
  openedAt: string;
  property: OrderProperty | null;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE = 25;

/* ── Constants ─────────────────────────────────────────────────────────────── */

const SOURCE_LABELS: Record<string, string> = {
  manual_entry: 'TD Hub',
  softpro_sync: 'SoftPro',
};
const SOURCE_STYLES: Record<string, string> = {
  manual_entry: 'bg-orange-100 text-orange-800',
  softpro_sync: 'bg-blue-100 text-blue-800',
};

function fmtSource(s: string) {
  return SOURCE_LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtOpenedDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  } catch { return '—'; }
}

const EMAIL_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  sent:    'bg-green-100 text-green-800',
  failed:  'bg-red-100 text-red-800',
};

/* ── OrderTable ────────────────────────────────────────────────────────────── */

export function OrderTable({
  orders, loading, error, currentPage, totalPages, total, onPageChange, onRowClick,
}: {
  orders: Order[] | undefined;
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRowClick: (orderId: number) => void;
}) {
  const [modal, setModal] = useState<{ type: 'details' | 'confirmations'; order: Order } | null>(null);

  const closeModal = useCallback(() => setModal(null), []);

  return (
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
                <TH className="w-12 text-center">No.</TH>
                <TH>File No.</TH>
                <TH>Address</TH>
                <TH>Opened</TH>
                <TH>Type</TH>
                <TH>Product</TH>
                <TH>Sales Rep</TH>
                <TH>Created By</TH>
                <TH>Source</TH>
                <TH>Email</TH>
                <TH className="text-center">Dup Override</TH>
                <TH className="text-center w-20">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : orders && orders.length > 0
                  ? orders.map((order, idx) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        rowNum={(currentPage - 1) * PAGE_SIZE + idx + 1}
                        onClick={() => onRowClick(order.id)}
                        onAction={(type) => setModal({ type, order })}
                      />
                    ))
                  : null}
            </tbody>
          </table>
          {!loading && orders && orders.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">No orders found</p>
              <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing{' '}
            <span className="font-medium text-[#1A1A2E]">{(currentPage - 1) * PAGE_SIZE + 1}</span>–
            <span className="font-medium text-[#1A1A2E]">{Math.min(currentPage * PAGE_SIZE, total)}</span>{' '}
            of <span className="font-medium text-[#1A1A2E]">{total}</span>
          </p>
          <div className="flex items-center gap-1">
            <PagBtn disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>‹ Prev</PagBtn>
            {buildPageRange(currentPage, totalPages).map((p, i) =>
              p === null ? (
                <span key={`e${i}`} className="px-1 text-[#6B7280]">…</span>
              ) : (
                <PagBtn key={p} active={p === currentPage} onClick={() => onPageChange(p)}>{p}</PagBtn>
              ),
            )}
            <PagBtn disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next ›</PagBtn>
          </div>
        </div>
      )}

      {/* Modals */}
      {modal?.type === 'details' && (
        <OrderDetailsModal
          orderId={modal.order.id}
          fileNumber={modal.order.fileNumber}
          open
          onClose={closeModal}
        />
      )}
      {modal?.type === 'confirmations' && (
        <ConfirmationsModal
          orderId={modal.order.id}
          fileNumber={modal.order.fileNumber}
          open
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/* ── OrderRow ──────────────────────────────────────────────────────────────── */

function OrderRow({ order, rowNum, onClick, onAction }: {
  order: Order;
  rowNum: number;
  onClick: () => void;
  onAction: (type: 'details' | 'confirmations') => void;
}) {
  const [dupOverride, setDupOverride] = useState(order.dupOverride ?? false);
  const [toggling, setToggling] = useState(false);

  async function toggleDup(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !dupOverride;
    setToggling(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/dup-override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setDupOverride(next);
    } catch { /* noop */ }
    finally { setToggling(false); }
  }

  const emailSt = order.emailStatus ?? 'none';
  const emailColor = EMAIL_COLORS[emailSt] ?? 'bg-gray-100 text-gray-500';
  const fullAddr = formatAddress(order.property);
  const truncAddr = fullAddr.length > 40 ? fullAddr.slice(0, 40) + '…' : fullAddr;
  const createdByDisplay = formatCreatedBy(order.createdByName);
  const createdByClass = createdByVariant(order.createdByName) === 'system'
    ? 'text-[#9CA3AF] italic'
    : 'text-[#6B7280]';

  return (
    <tr onClick={onClick} className="hover:bg-gray-50 cursor-pointer transition-colors">
      <td className="px-4 py-3 text-center text-[#9CA3AF] tabular-nums">{rowNum}</td>
      <td className="px-4 py-3 font-mono font-medium text-[#1B2A4A] whitespace-nowrap">{order.fileNumber}</td>
      <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap" title={fullAddr}>{truncAddr}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap tabular-nums">{fmtOpenedDate(order.openedAt)}</td>
      <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{order.transactionType ?? '—'}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{order.productType ?? '—'}</td>
      <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{order.salesRepName ?? '—'}</td>
      <td className={`px-4 py-3 whitespace-nowrap ${createdByClass}`}>{createdByDisplay}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {order.source ? (
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${SOURCE_STYLES[order.source] ?? 'bg-gray-100 text-gray-600'}`}>
            {fmtSource(order.source)}
          </span>
        ) : <span className="text-[#9CA3AF]">—</span>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${emailColor}`}>
          {emailSt === 'none' ? '—' : emailSt}
        </span>
      </td>
      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
        <button onClick={toggleDup} disabled={toggling}
          title={dupOverride ? 'Dup override ON' : 'Dup override OFF'}
          className={`w-5 h-5 rounded border transition-colors ${
            dupOverride ? 'bg-[#1B2A4A] border-[#1B2A4A]' : 'bg-white border-gray-300 hover:border-[#1B2A4A]'
          } ${toggling ? 'opacity-50' : ''}`}>
          {dupOverride && (
            <svg className="w-full h-full text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      </td>
      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
        <ActionsDropdown
          onDetails={() => onAction('details')}
          onConfirmations={() => onAction('confirmations')}
        />
      </td>
    </tr>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap ${className}`}>{children}</th>;
}
