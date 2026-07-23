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

function addressKey(p: { address: string; city: string; state: string; zip?: string | null; apn?: string | null }) {
  return [p.address, p.city, p.state, p.zip ?? '', p.apn ?? ''].map((s) => s.trim().toLowerCase()).join('|');
}

export function usePreInitOnSiteX(): UsePreInitOnSiteXResult {
  const [phase, setPhase] = useState<PreInitGatePhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [siteXSnapshot, setSiteXSnapshot] = useState<SiteXSnapshotForOrder | null>(null);
  const firedKeyRef = useRef<string | null>(null);
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
      clearTimers();
      return;
    }

    const key = addressKey(property);
    if (firedKeyRef.current === key && sessionId) {
      // Same confident match already in flight / done — do not re-fire.
      return;
    }

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
    setSessionId(null);
    setSiteXSnapshot(null);
    setPhase('skipped');
  }, [clearTimers]);

  const invalidateIfAddressChanged = useCallback((nextKey: string) => {
    if (!firedKeyRef.current || firedKeyRef.current === nextKey) return;
    clearTimers();
    firedKeyRef.current = null;
    setSessionId(null);
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
