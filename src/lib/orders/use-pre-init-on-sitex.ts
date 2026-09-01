'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isConfidentSiteXMatch } from '@/lib/domain/titlepoint/confident-sitex';

/** Cap how long submit waits for Tax+LV — searches continue server-side after. */
export const PRE_INIT_SUBMIT_GATE_MS = 45_000;
const POLL_INTERVAL_MS = 1_500;

export type PreInitGatePhase =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'ready'
  | 'timed_out'
  | 'skipped'
  | 'error';

export interface SiteXSnapshotForOrder {
  matchCode: 'S';
  apn: string | null;
  county: string | null;
  legalDescription: string | null;
  fips?: string | null;
  propertyType?: string | null;
  primaryOwner?: string | null;
  secondaryOwner?: string | null;
  fullAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface PreInitPropertyInput {
  address: string;
  city: string;
  state: string;
  county: string;
  apn: string | null;
  legalDescription: string | null;
  fips?: string | null;
  propertyType?: string | null;
  primaryOwner?: string | null;
  secondaryOwner?: string | null;
  fullAddress?: string | null;
  zip?: string | null;
}

export interface UsePreInitOnSiteXResult {
  phase: PreInitGatePhase;
  sessionId: string | null;
  siteXSnapshot: SiteXSnapshotForOrder | null;
  /** True only while a fired pre-init is still waiting (gates submit). */
  submitBlocked: boolean;
  preparingLabel: string | null;
  /** Call after a confident SiteX match. Re-fires when the address key changes. */
  onConfidentSiteX: (property: PreInitPropertyInput) => void;
  /** No usable match — clear gate; submit stays ungated. */
  onNoSiteXMatch: () => void;
  /** Address edited enough to invalidate the current session. */
  invalidateIfAddressChanged: (addressKey: string) => void;
}

/**
 * Shared address identity for invalidate-on-edit (Hub + client).
 *
 * Identity of the property a pre-init session belongs to.
 *
 * DELIBERATELY ADDRESS-BASED, NOT APN-BASED. This is recomputed on every
 * keystroke and compared by `invalidateIfAddressChanged`, so it is the guard
 * that stops a session for one property surviving into another. The `apn` here
 * comes from component state, which can still hold the PREVIOUSLY CONFIRMED
 * parcel while the operator types a new address — keying on it would report
 * "same property" for a property the operator has already left, and attach one
 * property's documents to another. That is the failure this key exists to
 * prevent (design edge case 4).
 *
 * Reuse of a live session is handled in `onConfidentSiteX` instead, where the
 * APN arrives from a fresh SiteX confirm rather than from form state.
 */
export function buildPreInitAddressKey(p: {
  address: string;
  city: string;
  state: string;
  zip?: string | null;
  apn?: string | null;
}): string {
  return [p.address, p.city, p.state, p.zip ?? '', p.apn ?? '']
    .map((s) => s.trim().toLowerCase())
    .join('|');
}

export function usePreInitOnSiteX(): UsePreInitOnSiteXResult {
  const [phase, setPhase] = useState<PreInitGatePhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [siteXSnapshot, setSiteXSnapshot] = useState<SiteXSnapshotForOrder | null>(null);
  const firedKeyRef = useRef<string | null>(null);
  /** APN of the parcel the live session belongs to, from a SiteX confirm. */
  const sessionApnRef = useRef<string | null>(null);
  const gateStartedAtRef = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (gateTimerRef.current) {
      clearTimeout(gateTimerRef.current);
      gateTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const startPolling = useCallback((sid: string) => {
    clearTimers();
    gateStartedAtRef.current = Date.now();
    setPhase('waiting');

    gateTimerRef.current = setTimeout(() => {
      setPhase((prev) => (prev === 'waiting' || prev === 'starting' ? 'timed_out' : prev));
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }, PRE_INIT_SUBMIT_GATE_MS);

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/titlepoint/pre-initiate/status?sessionId=${encodeURIComponent(sid)}`,
        );
        if (!res.ok) return;
        const body = await res.json() as { ready?: boolean };
        if (body.ready) {
          setPhase('ready');
          clearTimers();
        }
      } catch { /* keep polling until gate timeout */ }
    };

    void tick();
    pollTimerRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  }, [clearTimers]);

  const onConfidentSiteX = useCallback((property: PreInitPropertyInput) => {
    if (!isConfidentSiteXMatch(property)) {
      setPhase('skipped');
      setSessionId(null);
      firedKeyRef.current = null;
      sessionApnRef.current = null;
      clearTimers();
      return;
    }

    const key = buildPreInitAddressKey(property);
    if (firedKeyRef.current === key && sessionId) {
      // Same confident match already in flight / done — do not re-fire.
      return;
    }

    // ─── Reuse a live session for the same parcel ───────────────────────────
    //
    // Safe here and only here: `property` is a fresh SiteX confirm, so its APN
    // describes the parcel the operator just accepted, not whatever is left in
    // form state. `isConfidentSiteXMatch` has already required a single match.
    //
    // NOT a prerequisite for anything. The 53-sessions-across-31-addresses
    // figure was RETRIES downstream of the create failures fixed in #80 —
    // 15181 Jackson St fired five sessions and produced three SoftPro files
    // (20021669 and 20021679 cancelled, 20021683 kept), which is a create-retry
    // signature, not an operator editing an address. This is three lines that
    // cost nothing, kept because a second confirm of the same parcel has no
    // reason to start a second pair of searches.
    const confirmedApn = (property.apn ?? '').trim().toLowerCase();
    if (confirmedApn !== '' && sessionApnRef.current === confirmedApn && sessionId) {
      firedKeyRef.current = key;
      return;
    }
    sessionApnRef.current = confirmedApn || null;

    firedKeyRef.current = key;
    setSiteXSnapshot({
      matchCode: 'S',
      apn: property.apn,
      county: property.county,
      legalDescription: property.legalDescription,
      fips: property.fips ?? null,
      propertyType: property.propertyType ?? null,
      primaryOwner: property.primaryOwner ?? null,
      secondaryOwner: property.secondaryOwner ?? null,
      fullAddress: property.fullAddress ?? property.address,
      city: property.city,
      state: property.state,
      zip: property.zip ?? null,
    });

    clearTimers();
    setPhase('starting');
    setSessionId(null);

    void (async () => {
      try {
        const res = await fetch('/api/titlepoint/pre-initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: property.address,
            city: property.city,
            state: property.state,
            county: property.county,
            apn: property.apn,
          }),
        });
        const body = await res.json().catch(() => null) as {
          sessionId?: string;
          skipped?: boolean;
          error?: string;
        } | null;

        if (!res.ok || !body?.sessionId) {
          setPhase('error');
          return;
        }

        if (body.skipped) {
          // TitlePoint shut off — do not gate submit.
          setSessionId(body.sessionId);
          setPhase('skipped');
          return;
        }

        setSessionId(body.sessionId);
        startPolling(body.sessionId);
      } catch {
        setPhase('error');
      }
    })();
  }, [clearTimers, sessionId, startPolling]);

  const onNoSiteXMatch = useCallback(() => {
    clearTimers();
    firedKeyRef.current = null;
    sessionApnRef.current = null;
    setSessionId(null);
    setSiteXSnapshot(null);
    setPhase('skipped');
  }, [clearTimers]);

  /**
   * Drop the session when the operator has moved to a different property.
   *
   * Unchanged behaviour: any change to the address key invalidates. See
   * `buildPreInitAddressKey` for why this is not keyed on the APN.
   */
  const invalidateIfAddressChanged = useCallback((nextKey: string) => {
    if (!firedKeyRef.current || firedKeyRef.current === nextKey) return;
    clearTimers();
    firedKeyRef.current = null;
    sessionApnRef.current = null;
    setSessionId(null);
    setSiteXSnapshot(null);
    setPhase('idle');
  }, [clearTimers]);

  const submitBlocked = phase === 'starting' || phase === 'waiting';
  const preparingLabel = submitBlocked ? 'Preparing title data…' : null;

  return {
    phase,
    sessionId,
    siteXSnapshot,
    submitBlocked,
    preparingLabel,
    onConfidentSiteX,
    onNoSiteXMatch,
    invalidateIfAddressChanged,
  };
}
