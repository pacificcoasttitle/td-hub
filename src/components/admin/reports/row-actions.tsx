'use client';

import { useState } from 'react';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';
import type { CompCriteria } from '@/lib/domain/concierge/comp-filter';
import { ConciergeCriteriaPanel } from '@/components/hub/split/concierge-criteria-panel';

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
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={retry}
        className="text-xs font-medium text-[#1B2A4A] hover:underline disabled:text-[#9AA0AA] disabled:no-underline"
      >
        {busy ? 'Trying…' : 'Try again'}
      </button>
      {error ? <span className="max-w-[220px] whitespace-normal text-right text-[11px] text-[#8E2A1E]">{error}</span> : null}
    </span>
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
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={loading}
          onClick={open}
          className="text-xs font-medium text-[#1B2A4A] hover:underline disabled:text-[#9AA0AA] disabled:no-underline"
        >
          {loading ? 'Opening…' : 'Comparables'}
        </button>
        {openError ? <span className="max-w-[220px] whitespace-normal text-right text-[11px] text-[#8E2A1E]">{openError}</span> : null}
      </span>
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
