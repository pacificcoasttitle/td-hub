'use client';

import { useEffect, useState } from 'react';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { MenuItem } from './row-menu';

// ─── Whether this deploy can call MyNHD, asked once for the whole page ──────
//
// One shared promise, not one request per row. A Reports page is twenty rows
// and this answer is a property of the deploy, identical for all of them —
// twenty identical GETs to learn one boolean is the kind of thing that looks
// free in development and shows up as a thundering herd on a slow connection.
//
// Module-level, so it survives rows mounting and unmounting as the list
// reloads. Not cached across a page load: a key removed or rotated badly
// should take effect on the next visit, which is soon enough for a control
// that only ever hides itself.
let availability: Promise<boolean> | null = null;

function askAvailability(): Promise<boolean> {
  availability ??= fetch('/api/concierge/access')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { hazardAvailable?: boolean } | null) => d?.hazardAvailable === true)
    // FAIL CLOSED. If we cannot tell, do not offer a vendor action — the
    // failure mode of guessing "available" is an operator clicking a button
    // that refuses, which is the thing this exists to prevent.
    .catch(() => false);
  return availability;
}

/** Visible for tests. A module-level cache otherwise leaks between them. */
export function __resetAvailabilityForTests(): void {
  availability = null;
}

// ─── Adding the hazard sheet to a profile that already exists ───────────────
//
// THE MIRROR IMAGE OF TaxDetailControl, AND THE DIFFERENCE IS THE POINT. That
// one is the only control in this menu that spends, and it says its price in
// every offer because it sits among free actions and silence would read as
// free. This one IS free — Gerard, 12 Oct 2026 — so it says so, for the same
// reason in reverse: among a priced item and free ones, an item that says
// nothing about cost is ambiguous exactly where it matters.
//
// WHAT IT OFFERS DEPENDS ON WHERE THE PROFILE IS. The states are fewer than
// tax's, because MyNHD answers in one round trip and nothing is bought:
//
//   never asked   offer it, free
//   pending       offer a retry. Nothing was bought, so there is nothing to
//                 resume — see nhd-bridge.ts. Unlike tax, asking again starts
//                 over, and that is honest to say rather than hide
//   fetched       offer to put it on the document. The PNG is stored and the
//                 document does not show it yet — the state profile 9 was
//                 silently in on the tax side while reporting itself ready
//   ready         no offer. It is on the document
//   failed        offer a retry, with the vendor's own reason underneath

/** What the row's hazard_status means for what we may offer. */
export function hazardOffer(status: string | null, error: string | null): {
  kind: 'add' | 'finish' | 'retry' | 'none';
  label: string;
  note: string;
  tone: 'default' | 'muted';
} {
  switch (status) {
    case 'ready':
      return {
        kind: 'none',
        label: 'Hazard preview included',
        note: 'The flood and fire preview is on the document.',
        tone: 'muted',
      };
    case 'fetched':
      return {
        kind: 'finish',
        label: 'Hazard preview ready — add it to the document',
        note: 'The preview is stored. This re-renders the document to show it. Free.',
        tone: 'default',
      };
    case 'pending':
      return {
        kind: 'retry',
        // NOT "running — check again". That wording is true of a tax search,
        // which is sitting at TitlePoint with an id to resume. MyNHD answers in
        // one call, so a profile stuck here was interrupted, and the only thing
        // to do is ask again from the start.
        label: 'Hazard preview did not finish — try again',
        note: 'MyNHD answers in one call, so there is nothing part-finished to resume. This asks again. Free.',
        tone: 'default',
      };
    case 'failed':
      return {
        kind: 'retry',
        label: 'Retry hazard preview',
        // The vendor's own words, when we have them. "It didn't work" is not
        // something an operator can act on, and the reason is on the row.
        note: error?.trim()
          ? `Last attempt: ${error.trim()} Trying again is free.`
          : 'The last attempt did not return a preview. Trying again is free.',
        tone: 'default',
      };
    default:
      return {
        kind: 'add',
        label: 'Add hazard preview — free',
        note: 'A one-page flood and fire preview from MyNHD, added as its own sheet. It is a preview, not a Natural Hazard Disclosure.',
        tone: 'default',
      };
  }
}

/**
 * Does this offer need MyNHD?
 *
 * The rule the gate turns on, and the reason it is not simply "hide
 * everything": 'finish' puts an ALREADY FETCHED PNG on the document, which is
 * renderProfile and reaches no vendor at all — requestHazardPreview returns on
 * that branch before it ever reads the MyNHD config. 'none' is a statement
 * about the document rather than an offer.
 *
 * So a deploy that cannot call MyNHD can still finish what it already has, and
 * can still say that a profile has a preview. What disappears is the offer to
 * go and get one.
 */
export function offerNeedsVendor(kind: 'add' | 'finish' | 'retry' | 'none'): boolean {
  return kind === 'add' || kind === 'retry';
}

export function HazardPreviewControl({ row, onChanged, available }: {
  row: ReportListRow;
  onChanged?: () => void;
  /**
   * Overrides the fetch. For tests and for a caller that already knows.
   * `undefined` means "ask", which is the normal path.
   */
  available?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [canCall, setCanCall] = useState<boolean | null>(available ?? null);

  useEffect(() => {
    if (available !== undefined) return;
    let cancelled = false;
    void askAvailability().then((v) => { if (!cancelled) setCanCall(v); });
    return () => { cancelled = true; };
  }, [available]);

  const offer = hazardOffer(row.hazardStatus ?? null, row.hazardError ?? null);

  async function go() {
    setBusy(true); setResult(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${row.id}/nhd`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      // The route answers 200 for a vendor refusal and 409 only when the
      // profile cannot be asked at all. Both carry a true message.
      setResult(body?.message ?? (res.ok ? 'Done.' : `That did not work (${res.status}).`));
      onChanged?.();
    } catch {
      // Nothing was bought, so unlike the tax control this can say plainly that
      // no money is at stake — only whether the sheet landed.
      setResult('Network error — nothing was charged. Reload the list to see whether it landed.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <MenuItem label={busy ? 'Working…' : 'Hazard preview'} note={result} tone="muted" disabled />;
  }

  // ─── NOTHING, rather than an offer that can only be declined ─────────────
  //
  // `null` is "still asking" and `false` is "this deploy cannot call MyNHD".
  // Both render nothing for a vendor-reaching offer, and the loading case is
  // deliberate: showing the offer and then removing it is worse than a menu
  // that gains an item a moment later, because an operator may already have
  // clicked it.
  if (canCall !== true && offerNeedsVendor(offer.kind)) return null;

  if (offer.kind === 'none') {
    return <MenuItem label={offer.label} note={offer.note} tone="muted" disabled />;
  }

  return (
    <MenuItem
      label={busy ? (offer.kind === 'finish' ? 'Adding…' : 'Asking MyNHD…') : offer.label}
      note={offer.note}
      tone={offer.tone}
      disabled={busy}
      onSelect={go}
    />
  );
}
