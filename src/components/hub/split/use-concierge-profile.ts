'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CompCriteria } from '@/lib/domain/concierge/comp-filter';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── The operator's side of one property profile ────────────────────────────
//
// One rule runs through all of this: THE ONLY CALL THAT CAN SPEND IS
// `generate`. `adjust` and `retryRender` hit routes that cannot reach SiteX,
// and they report creditsCharged: 0 so the UI can say so out loud.

export interface ConciergeAccess {
  canGenerate: boolean;
  featureOn: boolean;
}

export interface UseConciergeProfile {
  profile: ProfileSummary | null;
  /** Resolved server-side from the order, so the gate shows what the document will say. */
  presentingRep: { name: string; email: string | null; phone: string | null } | null;
  presentingRepProblem: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  spend: { thisMonth: number; allTime: number } | null;
  gateOpen: boolean;
  criteriaOpen: boolean;
  openGate: () => void;
  closeGate: () => void;
  openCriteria: () => void;
  closeCriteria: () => void;
  generate: (input: GenerateArgs) => Promise<void>;
  adjust: (c: CompCriteria) => Promise<void>;
  retryRender: () => Promise<void>;
}

export interface GenerateArgs {
  orderId: number | null;
  street: string; city: string; state: string; zip: string;
  preparedForName: string;
  preparedForCompany: string | null;
  /** Which contact, not their details — the server resolves the rest. */
  presentingRepContactId?: number | null;
}

export function useConciergeProfile(orderId: number | null, access: ConciergeAccess): UseConciergeProfile {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [presentingRep, setPresentingRep] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);
  const [presentingRepProblem, setPresentingRepProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spend, setSpend] = useState<{ thisMonth: number; allTime: number } | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);

  // The tile has to know whether a profile already exists before it can decide
  // whether to offer Generate. Offering it on an order that already has one is
  // how a second credit gets spent.
  useEffect(() => {
    let cancelled = false;

    if (!orderId || !access.canGenerate) {
      // Deferred rather than set inline: clearing state synchronously inside an
      // effect cascades a render. The tile shows "Checking…" for one frame,
      // which is honest — it has not checked yet.
      queueMicrotask(() => {
        if (cancelled) return;
        setProfile(null); setPresentingRep(null); setPresentingRepProblem(null); setLoading(false);
      });
      return () => { cancelled = true; };
    }

    queueMicrotask(() => { if (!cancelled) setLoading(true); });
    fetch(`/api/orders/${orderId}/concierge-profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profile: ProfileSummary | null; presentingRep: typeof presentingRep; presentingRepProblem: string | null } | null) => {
        if (cancelled) return;
        setProfile(d?.profile ?? null);
        setPresentingRep(d?.presentingRep ?? null);
        setPresentingRepProblem(d?.presentingRepProblem ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, access.canGenerate]);

  const openGate = useCallback(() => {
    setError(null);
    setGateOpen(true);
    // Fetched when the gate opens, so the number the operator reads is current
    // rather than whatever it was when the page loaded.
    fetch('/api/concierge/spend')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { thisMonth: number; allTime: number } | null) => { if (d) setSpend(d); })
      .catch(() => {});
  }, []);

  const closeGate = useCallback(() => { setGateOpen(false); setError(null); }, []);
  const openCriteria = useCallback(() => { setCriteriaOpen(true); setError(null); }, []);
  const closeCriteria = useCallback(() => { setCriteriaOpen(false); setError(null); }, []);

  /** THE ONLY SPENDING CALL IN THIS FILE. */
  const generate = useCallback(async (input: GenerateArgs) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/concierge/profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Generation failed (${res.status}).`);
        // A failed generation still produced a row, and it may have cost a
        // credit. Refresh so the tile shows the failure rather than inviting a
        // second click at an apparently empty tile.
        if (body?.profileId) await refresh(body.profileId, setProfile);
        if (body?.spend) setSpend(body.spend);
        return;
      }
      if (body?.spend) setSpend(body.spend);
      await refresh(body.profileId, setProfile);
      setGateOpen(false);
    } catch {
      setError('Network error — the profile may or may not have been generated. Check the tile before trying again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const freeCall = useCallback(async (url: string, init: RequestInit, onDone: () => void) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? 'That did not work.'); return; }
      setProfile(body as ProfileSummary);
      onDone();
    } catch {
      setError('Network error. Nothing was charged — re-rendering never is.');
    } finally {
      setBusy(false);
    }
  }, []);

  const adjust = useCallback(async (c: CompCriteria) => {
    if (!profile) return;
    await freeCall(`/api/concierge/profiles/${profile.id}/criteria`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c),
    }, () => setCriteriaOpen(false));
  }, [profile, freeCall]);

  const retryRender = useCallback(async () => {
    if (!profile) return;
    await freeCall(`/api/concierge/profiles/${profile.id}/render`, { method: 'POST' }, () => {});
  }, [profile, freeCall]);

  return {
    profile, presentingRep, presentingRepProblem, loading, busy, error, spend, gateOpen, criteriaOpen,
    openGate, closeGate, openCriteria, closeCriteria, generate, adjust, retryRender,
  };
}

async function refresh(id: number | undefined, set: (p: ProfileSummary | null) => void) {
  if (!id) return;
  const r = await fetch(`/api/concierge/profiles/${id}`);
  if (r.ok) set(await r.json() as ProfileSummary);
}
