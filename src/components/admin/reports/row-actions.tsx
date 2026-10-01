'use client';

import { useState } from 'react';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';
import type { CompCriteria } from '@/lib/domain/concierge/comp-filter';
import { ConciergeCriteriaPanel } from '@/components/hub/split/concierge-criteria-panel';
import { MenuItem } from './row-menu';

// ─── The two row actions that used to do nothing ────────────────────────────
//
// "Try again" and "Comparables" shipped on the Reports list as buttons with no
// handler. A control that does nothing is worse than one that is not there: it
// teaches the operator that the page does not work.
//
// Both are FREE. Neither can reach the vendor — the retry route and the
// criteria route are both on the non-spending side of the concierge split.

/** POST the free retry; the server decides what a failed row needs. */
export function RetryControl({ row, onChanged }: { row: ReportListRow; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/reports/${row.type}/${row.id}/retry`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? `That did not work (${res.status}).`); return; }
      onChanged?.();
    } catch {
      setError('Network error. Nothing was charged — trying again never is.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MenuItem
      label={busy ? 'Trying…' : 'Try again — free'}
      note={error ?? 'Retrying never costs anything: it finishes what was already paid for.'}
      tone={error ? 'danger' : 'default'}
      disabled={busy}
      onSelect={retry}
    />
  );
}

/**
 * Re-render a profile on the CURRENT template, free.
 *
 * WHY THIS EXISTS AS ITS OWN CONTROL. Generating a new profile does not get
 * you a newer document — it gets newer DATA rendered by whatever template is
 * deployed. Two Concierge credits were spent in two days generating fresh
 * profiles on the same parcel to see what a template change looked like, and
 * the second one came back on the OLD layout because the new one had not
 * merged yet. The credit bought nothing that was not already on file.
 *
 * Nothing in the interface separated "fresh data", which costs a credit, from
 * "fresh document", which is free and calls no vendor. `renderProfile()` cannot
 * spend: it imports nothing from integrations/sitex and a test asserts that.
 * The capability was always there; only the affordance was missing.
 *
 * The label says FREE, because next to a Generate button that plainly costs
 * something, silence reads as "probably also costs".
 */
export function RefreshDocumentControl({ row, currentTemplate, onChanged }: {
  row: ReportListRow;
  /** The template a re-render would produce. */
  currentTemplate: string;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const stale = row.templateVersion !== null && row.templateVersion !== currentTemplate;

  async function refresh() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${row.id}/render`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? `That did not work (${res.status}).`); return; }
      setDone(true);
      onChanged?.();
    } catch {
      setError('Network error. Nothing was charged — re-rendering never is.');
    } finally {
      setBusy(false);
    }
  }

  // THE EXPLANATION MOVED, IT DID NOT GO. It used to be five lines of body copy
  // inside a table cell, which is what forced the horizontal scroll. Here it is
  // a note on the item it explains, and the ROW carries a small badge saying the
  // layout is old — because that is the part an operator has to see without
  // opening anything. See ReportRow.
  const note = error
    ?? (stale && !done
      ? `Made with an older layout (${row.templateVersion}). Free — it re-renders what we already paid for and calls no vendor.`
      : 'Re-renders the document on the current layout. Calls no vendor.');

  return (
    <MenuItem
      label={busy ? 'Refreshing…' : done ? 'Refreshed' : 'Refresh document — free'}
      note={note}
      tone={error ? 'danger' : 'default'}
      disabled={busy || done}
      onSelect={refresh}
    />
  );
}

/** Open the criteria panel on a concierge profile; applying re-renders for free. */
export function ComparablesControl({ row, onChanged }: { row: ReportListRow; onChanged?: () => void }) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function open() {
    setLoading(true); setOpenError(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${row.id}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) { setOpenError(body?.error ?? `The profile could not be opened (${res.status}).`); return; }
      setError(null);
      setProfile(body as ProfileSummary);
    } catch {
      setOpenError('Network error — the profile could not be opened.');
    } finally {
      setLoading(false);
    }
  }

  async function apply(c: CompCriteria) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${row.id}/criteria`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? 'That did not work.'); return; }
      setProfile(null);
      // Settings on the list is rewritten by every render; reload to show it.
      onChanged?.();
    } catch {
      setError('Network error. Nothing was charged — re-rendering never is.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MenuItem
        label={loading ? 'Opening…' : 'Comparables — free'}
        note={openError ?? 'Adjust the criteria and re-render. The comparables are already stored; nothing is looked up again.'}
        tone={openError ? 'danger' : 'default'}
        disabled={loading}
        onSelect={open}
      />
      {/* Mounted only while open, so the sliders start from the criteria the
          profile actually has — the panel's own rule. */}
      {profile ? (
        <ConciergeCriteriaPanel
          profile={profile}
          busy={busy}
          error={error}
          onClose={() => { if (!busy) setProfile(null); }}
          onApply={apply}
        />
      ) : null}
    </>
  );
}
