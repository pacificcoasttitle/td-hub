'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CplModal } from '@/components/shared/action-modals/cpl-modal';
import { PrelimModal } from '@/components/shared/action-modals/prelim-modal';
import { ProposedInsuredModal } from '@/components/shared/action-modals/proposed-insured-modal';
import { NotesModal } from '@/components/shared/action-modals/notes-modal';
import { BatchProcessModal, type BatchResult } from '@/components/shared/batch-process-modal';
import type { HubOrder } from '@/components/shared/orders-hub-table';
import {
  DEFAULT_QUEUE, hubQueue, isHubQueueId, queueAtPosition,
  type HubQueueCounts, type HubQueueId,
} from '@/lib/domain/orders/hub-queues';
import {
  fullAddress, isIncomplete, isShellOrder, nextIncompleteIndex, type HubListOrder,
} from '@/lib/domain/orders/hub-list-row';
import { QueueRail } from './queue-rail';
import { OrderList, type SortField } from './order-list';
import { OrderDetail } from './order-detail';
import { SplitToolbar } from './split-toolbar';
import { HubStatusBar } from './hub-status-bar';

// ─── Split view shell ────────────────────────────────────────────────────────
//
// h-screen is set by the hub layout; every flex child that owns a scroll area
// carries min-h-0. Without that the page scrolls as one document instead of two
// independent panes, which is the usual way this layout fails and it fails
// silently — it looks almost right.

const PAGE_SIZE = 100;
const FILTER_DEBOUNCE_MS = 200;

export type SplitRow = HubListOrder & {
  documents?: HubOrder['documents'];
  propertyZip: string | null;
  softproStatus: string | null;
};

type ModalType = 'cpl' | 'proposed' | 'prelim' | 'notes' | null;
type Density = 'dense' | 'roomy';

interface Query {
  queue: HubQueueId;
  search: string;
  sortBy: SortField;
  sortDir: 'asc' | 'desc';
  page: number;
}

/**
 * Every change to what is being asked for resets paging in the same update.
 * Resetting the page in a separate effect fires one fetch for the new filter at
 * the old page — which appends the wrong rows before the correction lands.
 */
function ask(prev: Query, patch: Partial<Query>): Query {
  return { ...prev, ...patch, page: patch.page ?? 1 };
}

export function OrdersSplitView({
  userKey, onSwitchToTable,
}: {
  /** Scopes the persisted density preference to the signed-in user, not the browser. */
  userKey: string;
  onSwitchToTable: () => void;
  /** Both conditions resolved server-side. The UI hides what the server would refuse. */
}) {
  // ─── data ───
  const [query, setQuery] = useState<Query>({
    queue: DEFAULT_QUEUE, search: '', sortBy: 'openedAt', sortDir: 'desc', page: 1,
  });
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<HubQueueCounts | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // ─── inputs ───
  const [filterText, setFilterText] = useState('');
  const [searchText, setSearchText] = useState('');

  // ─── selection ───
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [outsideOrder, setOutsideOrder] = useState<SplitRow | null>(null);
  const [bulk, setBulk] = useState<number[]>([]);
  const bulkAnchor = useRef<number | null>(null);

  // ─── view prefs / modals ───
  const [density, setDensity] = useState<Density>('dense');
  const [modal, setModal] = useState<ModalType>(null);
  const [batchState, setBatchState] = useState<
    { type: string; orders: HubOrder[]; current: number; results: BatchResult[] } | null
  >(null);
  const [syncBusy, setSyncBusy] = useState<'resync' | 'retry_tp' | null>(null);
  const [preparedForName, setPreparedForName] = useState('');
  const [preparedForCompany, setPreparedForCompany] = useState('');

  const filterRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const densityKey = `pct.hub.density.${userKey}`;

  // ─── one-time: restore deep link and density ─────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    if (order) setSelectedFile(order);
    const q = params.get('queue');
    if (isHubQueueId(q)) setQuery((prev) => ask(prev, { queue: q }));
    const saved = window.localStorage.getItem(densityKey);
    if (saved === 'dense' || saved === 'roomy') setDensity(saved);
    // Deliberately mount-only: this reads the URL the user arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── list fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(PAGE_SIZE),
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    if (query.queue !== 'all') params.set('queue', query.queue);
    if (query.search) params.set('search', query.search);

    fetch(`/api/orders?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not load orders (${r.status}).`);
        return r.json();
      })
      .then((d: { orders: SplitRow[]; total: number }) => {
        if (cancelled) return;
        setError(null);
        setTotal(d.total ?? 0);
        setRows((prev) => (query.page === 1 ? d.orders : [...prev, ...d.orders]));
        setHasMore(query.page * PAGE_SIZE < (d.total ?? 0));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [query, reloadToken]);

  // ─── queue counts ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch('/api/orders/queue-counts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HubQueueCounts | null) => { if (!cancelled && d) setCounts(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [reloadToken]);

  // ─── queue filter, debounced ──────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery((prev) => (prev.search === filterText ? prev : ask(prev, { search: filterText })));
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filterText]);

  // ─── selection ────────────────────────────────────────────────────────────
  const selectedIndex = useMemo(
    () => rows.findIndex((r) => r.fileNumber === selectedFile),
    [rows, selectedFile],
  );
  const selected: SplitRow | null =
    selectedIndex >= 0 ? rows[selectedIndex]! : outsideOrder;

  // Everything the Property Profile tile needs. The ONLY call in here that can
  // spend is generate(); adjust and retryRender hit routes that cannot reach
  // SiteX at all.

  const select = useCallback((o: HubListOrder) => {
    setSelectedFile(o.fileNumber);
    setBulk([]);
    bulkAnchor.current = null;
  }, []);

  // Keep ?order= in the URL without a route change: replaceState leaves the
  // React tree alone, so selecting a row never re-renders the list.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedFile) url.searchParams.set('order', selectedFile);
    else url.searchParams.delete('order');
    if (query.queue === DEFAULT_QUEUE) url.searchParams.delete('queue');
    else url.searchParams.set('queue', query.queue);
    window.history.replaceState(null, '', url.toString());
  }, [selectedFile, query.queue]);

  // A selected order that is not in the current queue stays visible. Losing
  // your place on every filter change is the papercut that kills a split view.
  useEffect(() => {
    if (!selectedFile) { setOutsideOrder(null); return; }
    if (selectedIndex >= 0) { setOutsideOrder(null); return; }
    if (loading) return;
    if (outsideOrder?.fileNumber === selectedFile) return;
    let cancelled = false;
    fetch(`/api/orders?search=${encodeURIComponent(selectedFile)}&pageSize=5`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { orders: SplitRow[] } | null) => {
        if (cancelled || !d) return;
        setOutsideOrder(d.orders.find((o) => o.fileNumber === selectedFile) ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedFile, selectedIndex, loading, outsideOrder?.fileNumber]);

  // ─── actions ──────────────────────────────────────────────────────────────
  const selectQueue = useCallback((id: HubQueueId) => {
    setFilterText('');
    setSearchText('');
    setQuery((prev) => ask(prev, { queue: id, search: '' }));
  }, []);

  const submitSearch = useCallback(() => {
    // "Searches all orders, not just the active queue" — so it moves you to ALL
    // rather than quietly returning results the rail says you are not looking at.
    setFilterText('');
    setQuery((prev) => ask(prev, { queue: 'all', search: searchText }));
  }, [searchText]);

  const goToIndex = useCallback((i: number) => {
    const row = rows[i];
    if (row) select(row);
  }, [rows, select]);

  const move = useCallback((delta: number) => {
    if (rows.length === 0) return;
    const base = selectedIndex >= 0 ? selectedIndex : (delta > 0 ? -1 : 0);
    const next = Math.min(rows.length - 1, Math.max(0, base + delta));
    goToIndex(next);
  }, [rows.length, selectedIndex, goToIndex]);

  const jumpNextIncomplete = useCallback(() => {
    const i = nextIncompleteIndex(rows, selectedIndex);
    if (i >= 0) goToIndex(i);
  }, [rows, selectedIndex, goToIndex]);

  const bulkOrders = useMemo(
    () => bulk.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as SplitRow[],
    [bulk, rows],
  );

  const runSyncAction = useCallback(async (o: HubListOrder, type: 'resync' | 'retry_tp') => {
    setSyncBusy(type);
    try {
      const url = type === 'resync'
        ? `/api/orders/${o.id}/resync`
        : `/api/orders/${o.id}/titlepoint/retry`;
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) {
        window.alert(body?.error ?? 'Request failed');
        return;
      }
      if (type === 'resync') {
        window.alert(body?.message ?? (body?.updated ? 'Resynced from SoftPro.' : 'SoftPro re-pulled — no changes'));
      }
      setReloadToken((n) => n + 1);
    } catch {
      window.alert('Network error — please try again');
    } finally {
      setSyncBusy(null);
    }
  }, []);

  const runBulk = useCallback(async (type: 'cpl' | 'proposed' | 'prelim') => {
    const orders = bulkOrders as unknown as HubOrder[];
    if (orders.length === 0) return;
    setBatchState({ type, orders, current: 0, results: [] });

    const finish = (results: BatchResult[]) =>
      setBatchState((s) => (s ? { ...s, current: orders.length, results } : null));

    if (type === 'prelim') {
      const results: BatchResult[] = [];
      for (let i = 0; i < orders.length; i++) {
        setBatchState((s) => (s ? { ...s, current: i + 1 } : null));
        try {
          const res = await fetch(`/api/orders/${orders[i]!.id}/fetch-prelim`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Failed');
          results.push({ order: orders[i]!, ok: true });
        } catch (err) {
          results.push({ order: orders[i]!, ok: false, error: err instanceof Error ? err.message : 'Failed' });
        }
        setBatchState((s) => (s ? { ...s, results: [...results] } : null));
      }
      return;
    }

    const url = type === 'cpl' ? '/api/orders/batch/cpl' : '/api/orders/batch/proposed-insured';
    const body: Record<string, unknown> = { orderIds: orders.map((o) => o.id) };
    if (type === 'cpl') body.underwriter = 'westcor';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Batch request failed');
      const map = new Map<number, { success: boolean; error?: string }>(
        (data?.results ?? []).map((r: { orderId: number; success: boolean; error?: string }) =>
          [r.orderId, { success: r.success, error: r.error }]),
      );
      finish(orders.map((o) => {
        const r = map.get(o.id);
        return { order: o, ok: r?.success === true, error: r?.success === true ? undefined : r?.error ?? 'No result returned' };
      }));
    } catch (err) {
      finish(orders.map((o) => ({ order: o, ok: false, error: err instanceof Error ? err.message : 'Batch request failed' })));
    }
  }, [bulkOrders]);

  /** Enter: the selected order's primary document, or the CPL modal if none. */
  const openPrimaryDocument = useCallback(() => {
    if (!selected) return;
    const docs = selected.documents;
    const id = docs?.cpl?.latestId ?? docs?.prelim?.latestId ?? null;
    if (id) window.open(`/api/documents/${id}/view`, '_blank', 'noopener');
    else if (!isShellOrder(selected)) setModal('cpl');
  }, [selected]);

  const fireAction = useCallback((type: 'cpl' | 'proposed' | 'prelim') => {
    if (bulkOrders.length >= 2) { void runBulk(type); return; }
    if (selected && !isShellOrder(selected)) setModal(type);
  }, [bulkOrders.length, runBulk, selected]);

  // ─── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );

      // Escape is the one key that works everywhere — it is how you get out.
      if (e.key === 'Escape') {
        if (inInput) { target!.blur(); return; }
        if (modal) { setModal(null); return; }
        if (bulk.length > 0) { setBulk([]); bulkAnchor.current = null; return; }
        listRef.current?.focus();
        return;
      }
      if (inInput || modal || batchState) return;
      if (e.altKey) return;

      // Tab, Enter and the arrows have real default behaviour: they traverse
      // focus and activate controls. The spec assigns Tab to Next incomplete
      // and Enter to the primary document, which is right while you are working
      // the list — and an accessibility regression if it also applies when
      // someone has tabbed into the toolbar. So those four are claimed only
      // when focus is in the list or nowhere. The single-letter shortcuts have
      // no default to steal and stay global.
      const active = document.activeElement;
      const inList = !active
        || active === document.body
        || active === listRef.current
        || (listRef.current?.contains(active) ?? false);

      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault(); searchRef.current?.focus(); return;
      }
      if (e.metaKey || e.ctrlKey) return;

      switch (e.key) {
        case 'j': e.preventDefault(); move(1); return;
        case 'k': e.preventDefault(); move(-1); return;
        case '/': e.preventDefault(); filterRef.current?.focus(); return;
        case 'c': e.preventDefault(); fireAction('cpl'); return;
        case 'i': e.preventDefault(); fireAction('proposed'); return;
        case 'p': e.preventDefault(); fireAction('prelim'); return;
        case 'n': e.preventDefault(); if (selected) setModal('notes'); return;
        case 'ArrowDown': if (inList) { e.preventDefault(); move(1); } return;
        case 'ArrowUp': if (inList) { e.preventDefault(); move(-1); } return;
        case 'Tab': if (inList) { e.preventDefault(); jumpNextIncomplete(); } return;
        case 'Enter': if (inList) { e.preventDefault(); openPrimaryDocument(); } return;
      }

      if (/^[1-6]$/.test(e.key)) {
        const q = queueAtPosition(Number(e.key));
        if (q) { e.preventDefault(); selectQueue(q.id); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, jumpNextIncomplete, fireAction, openPrimaryDocument, selectQueue, selected, modal, batchState, bulk.length]);

  // ─── shift-click extends into bulk mode ───────────────────────────────────
  const onRowSelect = useCallback((o: HubListOrder, ev: React.MouseEvent) => {
    if (ev.shiftKey && bulkAnchor.current !== null) {
      const a = rows.findIndex((r) => r.id === bulkAnchor.current);
      const b = rows.findIndex((r) => r.id === o.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setBulk(rows.slice(lo, hi + 1).map((r) => r.id));
        setSelectedFile(o.fileNumber);
        return;
      }
    }
    bulkAnchor.current = o.id;
    select(o);
  }, [rows, select]);

  const q = hubQueue(query.queue);
  const modalOrder = selected;
  const modalAddress = modalOrder ? (fullAddress(modalOrder) ?? '') : '';
  const anyIncomplete = useMemo(() => rows.some(isIncomplete), [rows]);

  // Notes are posted from the pane's footer strip. The strip clears itself
  // optimistically; a failure surfaces as the note simply not appearing, which
  // is the same signal a network failure gives anywhere else in this view.
  const [savingNote, setSavingNote] = useState(false);
  const addNote = useCallback(async (orderId: number, text: string) => {
    setSavingNote(true);
    try {
      await fetch(`/api/orders/${orderId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch {
      // Deliberately silent — see above.
    } finally {
      setSavingNote(false);
    }
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <SplitToolbar
        searchValue={searchText}
        selectedCount={bulk.length}
        density={density}
        searchRef={searchRef}
        onSearchChange={setSearchText}
        onSearchSubmit={submitSearch}
        onClearSelection={() => { setBulk([]); bulkAnchor.current = null; }}
        onBulk={(t) => void runBulk(t)}
        onToggleDensity={() => {
          const next: Density = density === 'dense' ? 'roomy' : 'dense';
          setDensity(next);
          window.localStorage.setItem(densityKey, next);
        }}
        onSwitchToTable={onSwitchToTable}
        onNextIncomplete={jumpNextIncomplete}
        incompleteAvailable={anyIncomplete}
      />

      <div className="flex-1 min-h-0 flex">
        <QueueRail active={query.queue} counts={counts} onSelect={selectQueue} />
        <OrderList
          queue={query.queue}
          rows={rows}
          total={total}
          loading={loading}
          error={error}
          filterText={filterText}
          sort={{ by: query.sortBy, dir: query.sortDir }}
          density={density}
          selectedId={selected?.id ?? null}
          outsideQueue={selectedIndex < 0 && outsideOrder !== null}
          filterInputRef={filterRef}
          listRef={listRef}
          onFilterChange={setFilterText}
          onSelect={onRowSelect}
          onSortChange={(by) => setQuery((prev) => ask(prev, {
            sortBy: by,
            sortDir: prev.sortBy === by && prev.sortDir === 'desc' ? 'asc' : 'desc',
          }))}
          onRetry={() => setReloadToken((n) => n + 1)}
          onScrollEnd={() => {
            if (hasMore && !loading) setQuery((prev) => ({ ...prev, page: prev.page + 1 }));
          }}
        />
        <OrderDetail
          order={selected}
          busy={syncBusy}
          onResync={(o) => void runSyncAction(o, 'resync')}
          onRetryTitlePoint={(o) => void runSyncAction(o, 'retry_tp')}
          documents={selected?.documents}
          onGenerateDocument={fireAction}
          savingNote={savingNote}
          onAddNote={addNote}
        />
      </div>

      <HubStatusBar
        queueLabel={q.label}
        queueCount={total}
        fileNumber={selected?.fileNumber ?? null}
        address={selected ? fullAddress(selected) : null}
      />

      {modalOrder && (
        <>
          <CplModal open={modal === 'cpl'} onClose={() => setModal(null)}
            orderId={modalOrder.id} fileNumber={modalOrder.fileNumber} address={modalAddress}
            onSuccess={() => setReloadToken((n) => n + 1)} />
          <ProposedInsuredModal open={modal === 'proposed'} onClose={() => setModal(null)}
            orderId={modalOrder.id} fileNumber={modalOrder.fileNumber} address={modalAddress}
            onSuccess={() => setReloadToken((n) => n + 1)} />
          <PrelimModal open={modal === 'prelim'} onClose={() => setModal(null)}
            orderId={modalOrder.id} fileNumber={modalOrder.fileNumber} address={modalAddress} />
          <NotesModal open={modal === 'notes'} onClose={() => setModal(null)}
            orderId={modalOrder.id} fileNumber={modalOrder.fileNumber} address={modalAddress} />
        </>
      )}

      {batchState && <BatchProcessModal state={batchState} onClose={() => setBatchState(null)} />}

      {/* The cost gate and the criteria panel are MOUNTED ONLY WHILE OPEN, so
          neither carries state from a previous property into the next one. */}
    </div>
  );
}
