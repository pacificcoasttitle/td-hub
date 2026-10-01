'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrderDocuments } from '@/components/shared/orders-hub-parts';

/** Same cadence as `/hub/order-confirm` — the list row does not update itself. */
export const ARRIVING_DOCS_POLL_MS = 10_000;

const ARRIVING_KEYS = ['legalVesting', 'grantDeed', 'tax'] as const;

export interface DocumentRowLite {
  id: number;
  category: string;
  createdAt?: string | Date | null;
}

export function arrivingDocsStillMissing(docs: OrderDocuments | undefined): boolean {
  if (!docs) return true;
  return ARRIVING_KEYS.some((key) => !docs[key]?.exists);
}

function asIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Overlay hub `documents` rows onto the list-row summary the pane already has. */
export function overlayDocumentsFromRows(
  base: OrderDocuments | undefined,
  rows: DocumentRowLite[],
): OrderDocuments | undefined {
  if (rows.length === 0) return base;

  const next: OrderDocuments = {
    cpl: base?.cpl ?? { exists: false, count: 0, latestId: null, latestCreatedAt: null },
    prelim: base?.prelim ?? { exists: false, count: 0, latestId: null, latestCreatedAt: null },
    proposedInsured: base?.proposedInsured ?? { exists: false, count: 0, latestId: null, latestCreatedAt: null },
    legalVesting: base?.legalVesting ?? { exists: false },
    tax: base?.tax ?? { exists: false },
    grantDeed: base?.grantDeed ?? { exists: false },
  };

  const byCat = new Map<string, DocumentRowLite[]>();
  for (const row of rows) {
    const list = byCat.get(row.category) ?? [];
    list.push(row);
    byCat.set(row.category, list);
  }

  const full = (category: string) => {
    const list = byCat.get(category) ?? [];
    if (list.length === 0) return null;
    const latest = list.reduce((a, b) => (a.id > b.id ? a : b));
    return {
      exists: true,
      count: list.length,
      latestId: latest.id,
      latestCreatedAt: asIso(latest.createdAt),
    };
  };

  const cpl = full('cpl');
  const prelim = full('prelim');
  const proposed = full('proposed_insured');
  if (cpl) next.cpl = cpl;
  if (prelim) next.prelim = prelim;
  if (proposed) next.proposedInsured = proposed;
  if ((byCat.get('legal_vesting') ?? []).length > 0) next.legalVesting = { exists: true };
  if ((byCat.get('tax') ?? []).length > 0) next.tax = { exists: true };
  if ((byCat.get('grant_deed') ?? []).length > 0) next.grantDeed = { exists: true };
  return next;
}

/**
 * The list row is painted immediately. While LV / grant deed / tax are still
 * missing, poll the order's documents the way the confirmation page polls
 * TitlePoint — every 10s — so the pane flips when the PDFs land without a reload.
 */
export function useArrivingDocuments(
  orderId: number | null,
  listDocuments: OrderDocuments | undefined,
): OrderDocuments | undefined {
  const [overlay, setOverlay] = useState<OrderDocuments | undefined>(undefined);
  const listRef = useRef(listDocuments);
  listRef.current = listDocuments;

  useEffect(() => {
    setOverlay(undefined);
    if (!orderId) return;

    let cancelled = false;
    const ac = new AbortController();
    let interval: ReturnType<typeof setInterval> | null = null;

    const pull = async (): Promise<OrderDocuments | undefined> => {
      const res = await fetch(`/api/orders/${orderId}/documents`, { signal: ac.signal });
      if (!res.ok) return listRef.current;
      const json = await res.json() as { documents?: DocumentRowLite[] };
      if (cancelled) return listRef.current;
      const next = overlayDocumentsFromRows(listRef.current, json.documents ?? []);
      setOverlay(next);
      return next;
    };

    (async () => {
      let latest: OrderDocuments | undefined;
      try {
        latest = await pull();
      } catch {
        latest = listRef.current;
      }
      if (cancelled || !arrivingDocsStillMissing(latest)) return;

      interval = setInterval(async () => {
        try {
          const updated = await pull();
          if (!arrivingDocsStillMissing(updated) && interval) {
            clearInterval(interval);
            interval = null;
          }
        } catch { /* next tick */ }
      }, ARRIVING_DOCS_POLL_MS);
    })();

    return () => {
      cancelled = true;
      ac.abort();
      if (interval) clearInterval(interval);
    };
  }, [orderId]);

  return overlay ?? listDocuments;
}
