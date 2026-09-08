'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  groupByDay, isShellOrder, listAddress, timeOfDay, typeChip,
  type HubListOrder,
} from '@/lib/domain/orders/hub-list-row';
import { hubQueue, type HubQueueId } from '@/lib/domain/orders/hub-queues';

export type SortField = 'openedAt' | 'fileNumber' | 'operationalStatus';

// ─── The dense list ──────────────────────────────────────────────────────────
//
// 352px wide: 32px header, 30px filter, and everything else scrolling rows.
// A row is 30px and never wraps — that single constraint is where the density
// win comes from, so anything that could make a row two lines tall (a wrapping
// client cell, a full address, a date) is either truncated or moved to the pane.

const ROW_H_DENSE = 30;
const ROW_H_ROOMY = 36;

export function OrderList({
  queue, rows, total, loading, error, filterText, sort, density,
  selectedId, outsideQueue, filterInputRef, listRef,
  onFilterChange, onSelect, onSortChange, onRetry, onScrollEnd,
}: {
  queue: HubQueueId;
  rows: HubListOrder[];
  total: number | null;
  loading: boolean;
  error: string | null;
  filterText: string;
  sort: { by: SortField; dir: 'asc' | 'desc' };
  density: 'dense' | 'roomy';
  selectedId: number | null;
  outsideQueue: boolean;
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  onFilterChange: (v: string) => void;
  onSelect: (o: HubListOrder, e: React.MouseEvent) => void;
  onSortChange: (by: SortField) => void;
  onRetry: () => void;
  onScrollEnd: () => void;
}) {
  const q = hubQueue(queue);
  const rowH = density === 'dense' ? ROW_H_DENSE : ROW_H_ROOMY;
  const groups = useMemo(() => groupByDay(rows, new Date()), [rows]);

  // Keep the selected row in view when the selection moves by keyboard.
  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="w-[352px] shrink-0 flex flex-col min-h-0 bg-white border-r border-[#E5E5E5]">
      {/* header — 32px */}
      <div className="h-8 shrink-0 flex items-center gap-2 px-[10px] border-b border-[#F0F1F3]">
        <span className="text-[11.5px] font-semibold text-[#171717] truncate">{q.label}</span>
        <span className="font-mono text-[11px] text-[#9AA0AA] tabular-nums">
          {total === null ? '' : total.toLocaleString('en-US')}
        </span>
        <div className="flex-1" />
        <SortButton sort={sort} onChange={onSortChange} />
      </div>

      {/* per-queue filter — 30px */}
      <div className="h-[30px] shrink-0 border-b border-[#E5E5E5] flex items-center px-[10px]">
        <span className="text-[#9AA0AA] text-[11px] mr-[6px]" aria-hidden>⌕</span>
        <input
          ref={filterInputRef}
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter this queue"
          aria-label={`Filter ${q.label}`}
          className="flex-1 min-w-0 text-[11.5px] outline-none placeholder:text-[#9AA0AA] bg-transparent"
        />
        <kbd className="text-[10px] text-[#9AA0AA] font-sans">/</kbd>
      </div>

      {outsideQueue && (
        <div className="shrink-0 px-[10px] py-[3px] text-[10.5px] text-[#B4620B] bg-[#FDF4E7] border-b border-[#EFD9AE]">
          Showing 1 order outside this queue
        </div>
      )}

      {/* rows — everything that is left, scrolls */}
      <div
        ref={listRef}
        role="listbox"
        aria-label={`${q.label} orders`}
        aria-activedescendant={selectedId === null ? undefined : `hub-order-${selectedId}`}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) onScrollEnd();
        }}
        className="flex-1 min-h-0 overflow-y-auto outline-none"
      >
        {error ? (
          <div className="p-4 text-[12px] text-[#8E2A1E]">
            {error}
            <button onClick={onRetry} className="ml-2 underline font-semibold">Retry</button>
          </div>
        ) : loading && rows.length === 0 ? (
          <SkeletonRows rowH={rowH} />
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-[#9AA0AA]">{q.emptyMessage}</div>
        ) : (
          groups.map((g) => (
            <div key={g.dayKey}>
              <div className="sticky top-0 z-10 h-[22px] bg-[#FAFAFB] border-b border-[#F0F1F3] flex items-center px-[10px]">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">
                  {g.label}
                </span>
                <div className="flex-1" />
                <span className="text-[9.5px] font-semibold text-[#9AA0AA] tabular-nums">{g.count}</span>
              </div>
              {g.orders.map((o) => (
                <Row
                  key={o.id}
                  order={o}
                  rowH={rowH}
                  selected={o.id === selectedId}
                  rowRef={o.id === selectedId ? selectedRef : undefined}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
        {loading && rows.length > 0 && (
          <div className="py-2 text-center text-[10.5px] text-[#9AA0AA]">Loading…</div>
        )}
      </div>
    </div>
  );
}

function Row({
  order, rowH, selected, rowRef, onSelect,
}: {
  order: HubListOrder;
  rowH: number;
  selected: boolean;
  rowRef?: React.RefObject<HTMLDivElement | null>;
  onSelect: (o: HubListOrder, e: React.MouseEvent) => void;
}) {
  const chip = typeChip(order.transactionType);
  const address = listAddress(order);
  const time = timeOfDay(order.openedAtIso);
  const failed = order.syncStatus === 'failed';

  return (
    <div
      ref={rowRef}
      id={`hub-order-${order.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={(e) => onSelect(order, e)}
      style={{
        height: rowH,
        boxShadow: selected ? 'inset 2px 0 0 #F26B2B' : undefined,
      }}
      className={[
        'flex items-center gap-[7px] px-[10px] border-b border-[#F5F5F6] cursor-default select-none',
        selected ? 'bg-[#FEF4EF]' : 'hover:bg-[#FAFAFB]',
      ].join(' ')}
    >
      <span
        className="w-[5px] h-[5px] rounded-full shrink-0"
        style={{ background: failed ? '#D6503F' : 'transparent' }}
        aria-hidden
      />
      <span className="w-[88px] shrink-0 font-mono text-[11.5px] tracking-[-0.01em] text-[#171717] truncate">
        {order.fileNumber}
      </span>
      <span
        title={chip.label}
        className="w-4 h-4 shrink-0 rounded-[4px] flex items-center justify-center text-[9.5px] font-semibold"
        style={{ color: chip.text, background: chip.bg }}
      >
        {chip.letter}
      </span>
      {address ? (
        <span className="flex-1 min-w-0 text-[12px] text-[#3C4557] truncate">{address}</span>
      ) : isShellOrder(order) ? (
        <span className="flex-1 min-w-0 text-[12px] text-[#9AA0AA] truncate">No property</span>
      ) : (
        <span className="flex-1 min-w-0">
          <Flag>no address</Flag>
        </span>
      )}
      <span className="shrink-0 font-mono text-[10.5px] text-[#9AA0AA] tabular-nums">
        {time ?? ''}
      </span>
    </div>
  );
}

/**
 * A missing value reads as an amber flag, never an em-dash.
 *
 * An em-dash drawn at full text weight makes the eye stop on every blank to
 * discard it. A small amber flag reads as "needs keying" without competing
 * with the real data beside it.
 */
function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-[10.5px] text-[#B4620B] bg-[#FDF4E7] rounded px-[6px] py-[1px] whitespace-nowrap">
      {children}
    </span>
  );
}

/** Skeletons are exactly one row tall so the list does not reflow when data lands. */
function SkeletonRows({ rowH }: { rowH: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: 22 }, (_, i) => (
        <div key={i} style={{ height: rowH }} className="flex items-center gap-[7px] px-[10px] border-b border-[#F5F5F6]">
          <span className="w-[5px]" />
          <span className="w-[88px] h-[9px] rounded bg-[#F1F2F4]" />
          <span className="w-4 h-4 rounded-[4px] bg-[#F1F2F4]" />
          <span className="flex-1 h-[9px] rounded bg-[#F5F6F8]" style={{ maxWidth: `${45 + (i * 13) % 45}%` }} />
        </div>
      ))}
    </div>
  );
}

const SORT_LABELS: Record<SortField, string> = {
  openedAt: 'Opened',
  fileNumber: 'File #',
  operationalStatus: 'Status',
};

function SortButton({
  sort, onChange,
}: {
  sort: { by: SortField; dir: 'asc' | 'desc' };
  onChange: (by: SortField) => void;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        className="h-6 px-[6px] rounded-[5px] text-[11px] font-semibold text-[#6B7280] hover:bg-[#F2F3F5] outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
      >
        Sort {sort.dir === 'desc' ? '↓' : '↑'}
      </button>
      <div className="absolute right-0 top-full z-30 hidden group-hover:block group-focus-within:block pt-1">
        <div className="bg-white border border-[#E5E5E5] rounded-[6px] shadow-lg py-1 w-[132px]">
          {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange(f)}
              className={[
                'w-full text-left px-3 py-[5px] text-[11.5px] hover:bg-[#FAFAFB]',
                f === sort.by ? 'font-semibold text-[#171717]' : 'text-[#6B7280]',
              ].join(' ')}
            >
              {SORT_LABELS[f]}
              {f === sort.by && <span className="ml-1">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
