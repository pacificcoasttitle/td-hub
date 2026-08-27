'use client';

import { useEffect, useState } from 'react';
import type { OrderParty } from '@/lib/domain/orders/order-parties';

// ─── The two things the list row cannot carry ───────────────────────────────
//
// The detail pane renders from the selected list row, with no fetch, which is
// what makes j/k feel instant — the pane cannot lag the selection because it
// IS the selection.
//
// Parties and notes are not on the row. Rather than give that property up,
// they load asynchronously and the sections say "Loading…" for the moment they
// take. The order card, the banners and the documents panel are all painted
// before this resolves.
//
// One AbortController per order id, so holding j down does not leave six
// in-flight requests racing to write the pane.

export interface OrderNote {
  id: number;
  subject: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface OrderExtras {
  parties: OrderParty[];
  /** Parties withheld because party_role has no name for them. Shown, not hidden. */
  unnamedRoleCount: number;
  notes: OrderNote[];
  loading: boolean;
}

export function useOrderExtras(orderId: number | null): OrderExtras {
  const [parties, setParties] = useState<OrderParty[]>([]);
  const [unnamedRoleCount, setUnnamed] = useState(0);
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setParties([]); setUnnamed(0); setNotes([]); setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);

    // Independent, so a failing notes read never blanks the parties list and
    // vice versa. Neither is important enough to surface an error banner over.
    const partiesReq = fetch(`/api/orders/${orderId}/parties`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { parties: OrderParty[]; unnamedRoleCount: number } | null) => {
        if (ac.signal.aborted) return;
        setParties(d?.parties ?? []);
        setUnnamed(d?.unnamedRoleCount ?? 0);
      })
      .catch(() => {});

    const notesReq = fetch(`/api/orders/${orderId}/notes`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { notes?: OrderNote[] } | null) => {
        if (ac.signal.aborted) return;
        setNotes(d?.notes ?? []);
      })
      .catch(() => {});

    Promise.all([partiesReq, notesReq]).finally(() => {
      if (!ac.signal.aborted) setLoading(false);
    });

    return () => ac.abort();
  }, [orderId]);

  return { parties, unnamedRoleCount, notes, loading };
}
