'use client';

import { useEffect, useState } from 'react';

// ─── Finish saving ───────────────────────────────────────────────────────────
//
// A half-created order — in SoftPro, missing its property in the hub — used to
// show only "Incomplete — no address" with a Resync button that cannot fix it:
// resync re-reads SoftPro, and the property row the create never wrote is not
// something a resync inserts. The fix was a message to Gerard.
//
// This asks the server whether the order is one of those (a recorded failed
// create, no property row), says so plainly, and offers the one action that
// finishes it. It asks ONLY for orders with no address, so the other 99% of
// selections cost no request.

type State =
  | { needed: true; fileNumber: string; failedAt: string; reason: string; payloadAvailable: boolean }
  | { needed: false; reason: string };

export function ReconcileBanner({
  orderId, hasAddress, onReconciled,
}: {
  orderId: number;
  hasAddress: boolean;
  onReconciled: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setState(null);
    setMessage(null);
    if (hasAddress) return;
    const ac = new AbortController();
    fetch(`/api/orders/${orderId}/reconcile`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => { if (!ac.signal.aborted) setState(d); })
      .catch(() => {});
    return () => ac.abort();
  }, [orderId, hasAddress]);

  if (hasAddress || !state || !state.needed) {
    return message?.tone === 'ok'
      ? <div className="border rounded-[9px] px-[13px] py-[9px] text-[12px] bg-[#EAF6EF] border-[#BFE3CD] text-[#1E6B43]">{message.text}</div>
      : null;
  }

  async function finish() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/reconcile`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setMessage({ tone: 'error', text: body?.error ?? body?.detail ?? 'Finish saving failed' });
        return;
      }
      const tp = body.titlePoint === 'started' ? ' Title search started.'
        : body.titlePoint === 'no_county' ? ' No county on the SoftPro payload, so the title search was not started.'
        : '';
      setMessage({ tone: 'ok', text: `Finished — ${body.fileNumber} now has its property.${tp}` });
      setState({ needed: false, reason: 'property_present' });
      onReconciled();
    } catch {
      setMessage({ tone: 'error', text: 'Network error — please try again' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-[9px] px-[13px] py-[9px] text-[12px] bg-[#FDECEA] border-[#F2C4BD] text-[#8E2A1E]">
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠</span>
        <div className="flex-1">
          <p>
            <strong>This order did not finish saving.</strong> {state.fileNumber} exists in SoftPro, but the hub
            is missing its property — so no title search has run. <strong>Do not re-enter it</strong>; that makes a
            second SoftPro file.
          </p>
          <p className="mt-1 text-[11.5px] opacity-80">{state.reason}</p>
          {message?.tone === 'error' && <p className="mt-1 font-semibold">{message.text}</p>}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => void finish()}
              disabled={busy || !state.payloadAvailable}
              title={state.payloadAvailable ? undefined : 'No SoftPro create payload is logged for this file — this one needs a person.'}
              className="h-6 px-[9px] rounded-[5px] bg-white border border-current/25 text-[11px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 hover:bg-white/70 disabled:opacity-50"
            >
              {busy ? 'Finishing…' : 'Finish saving'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
