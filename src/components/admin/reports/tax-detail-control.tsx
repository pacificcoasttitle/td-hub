'use client';

import { useState } from 'react';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { MenuItem } from './row-menu';

// ─── Buying page 4 for a profile that already exists ────────────────────────
//
// THE ONLY CONTROL IN THE REPORTS LIST THAT SPENDS, and the only one outside
// the create modal that spends at all. It exists because every profile made
// before the tax bridge shipped can still have page 4, and re-generating to get
// it would buy the property from SiteX a second time when we already hold it.
// This spends on TitlePoint only.
//
// IT SAYS WHAT IT COSTS, IN THE ITEM, next to controls that say "free". Every
// other action in this menu is free and two of them say so; an item that stayed
// silent about cost in that company would read as free too.
//
// WHAT IT OFFERS DEPENDS ON WHERE THE PROFILE IS, because the wrong offer here
// is either a wasted charge or a lie:
//
//   never asked   offer it, priced
//   pending       say it is running, and that asking again finishes rather than
//                 re-buys — that is true, and it is the thing an operator most
//                 needs to know when they are looking at a row that has been
//                 "running" for ten minutes
//   ready         no offer at all. Selling the same search twice is the failure
//                 this whole file is careful about
//   empty         no offer. The county has no record; a second identical search
//                 would return the same nothing and bill for it
//   denied        no offer, and say why. The county is not entitled, and that is
//                 not something a retry fixes
//   failed        offer a retry, priced. Nothing was charged for a failed
//                 create, so this one genuinely is a fresh purchase

/** What the row's tax_detail_status means for what we may offer. */
export function taxOffer(status: string | null): {
  kind: 'buy' | 'finish' | 'none';
  label: string;
  note: string;
  tone: 'default' | 'muted';
} {
  switch (status) {
    case 'ready':
      return { kind: 'none', label: 'Tax detail included', note: 'Page 4 shows the county tax report.', tone: 'muted' };
    case 'pending':
      return {
        kind: 'finish',
        label: 'Tax search running — check again',
        note: 'Already paid for. Checking finishes it and costs nothing; it never starts a second search.',
        tone: 'default',
      };
    case 'empty':
      return { kind: 'none', label: 'No county tax record', note: 'The search ran and found nothing for this parcel. Page 4 shows the assessment detail we already hold.', tone: 'muted' };
    case 'denied':
      return { kind: 'none', label: 'Tax detail unavailable', note: 'This county is not entitled for tax searches. Nothing was charged. Page 4 shows the assessment detail we already hold.', tone: 'muted' };
    case 'failed':
      return {
        kind: 'buy',
        label: 'Retry tax detail — one search',
        note: 'The last attempt failed before anything was charged, so this is a fresh search.',
        tone: 'default',
      };
    default:
      return {
        kind: 'buy',
        label: 'Add tax detail — one search',
        note: 'Installments, due dates, rate area and direct assessments. One TitlePoint search; the profile re-renders itself free when it lands.',
        tone: 'default',
      };
  }
}

export function TaxDetailControl({ row, onChanged }: { row: ReportListRow; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const offer = taxOffer(row.taxStatus);

  async function go() {
    setBusy(true); setResult(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${row.id}/tax`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      // The route answers 200 for a denial and 409 for "already running"; both
      // carry a true message and neither is an error to shout about.
      setResult(body?.message ?? (res.ok ? 'Started.' : `That did not work (${res.status}).`));
      onChanged?.();
    } catch {
      // HONEST ABOUT THE UNCERTAINTY. A network failure after the request left
      // the browser may or may not have started a paid search, and telling the
      // operator "nothing was charged" would be a guess. The row's own status is
      // the answer.
      setResult('Network error — the search may or may not have started. Reload the list to see.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <MenuItem label={busy ? 'Working…' : 'Tax detail'} note={result} tone="muted" disabled />;
  }

  if (offer.kind === 'none') {
    return <MenuItem label={offer.label} note={offer.note} tone="muted" disabled />;
  }

  return (
    <MenuItem
      label={busy ? (offer.kind === 'finish' ? 'Checking…' : 'Starting…') : offer.label}
      note={offer.note}
      tone={offer.tone}
      disabled={busy}
      onSelect={go}
    />
  );
}
