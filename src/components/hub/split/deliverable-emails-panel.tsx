'use client';

import { useCallback, useEffect, useState } from 'react';
import { isValidDeliverableEmail, MAX_DELIVERABLE_EMAILS } from '@/lib/domain/notifications/deliverable-emails-validation';

// ─── Editing the list after the order is open ───────────────────────────────
//
// Probably the more common case than getting it right at entry: people get
// added mid-transaction, and a list frozen at open is wrong within a week.
//
// REMOVAL TAKES EFFECT IMMEDIATELY. Someone removing an address is trying to
// stop that person receiving something. The row is soft-deleted server-side so
// it stays attributable, but the very next send excludes it.

interface Row {
  id: number;
  email: string;
  addedBy: string | null;
  addedAt: string;
}

export function DeliverableEmailsPanel({ orderId }: { orderId: number | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) { setRows([]); setDraft(''); setError(null); return; }
    const ac = new AbortController();
    setLoading(true);
    fetch(`/api/orders/${orderId}/deliverable-emails`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { emails?: Row[] } | null) => { if (!ac.signal.aborted) setRows(d?.emails ?? []); })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [orderId]);

  const add = useCallback(async () => {
    const email = draft.trim();
    if (!orderId || !email) return;
    if (!isValidDeliverableEmail(email)) { setError('Enter a valid email address.'); return; }

    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/deliverable-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [email] }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? 'That did not save.'); return; }
      setRows(body.emails ?? []);
      setDraft('');
      if (body.atLimit) setError(`Only ${MAX_DELIVERABLE_EMAILS} addresses are allowed.`);
    } catch {
      setError('Network error — nothing was saved.');
    } finally {
      setBusy(false);
    }
  }, [orderId, draft]);

  const remove = useCallback(async (id: number) => {
    if (!orderId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/deliverable-emails`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error ?? 'That did not remove.'); return; }
      setRows(body.emails ?? []);
    } catch {
      setError('Network error — nothing was removed.');
    } finally {
      setBusy(false);
    }
  }, [orderId]);

  const atLimit = rows.length >= MAX_DELIVERABLE_EMAILS;

  return (
    <section className="bg-white border border-[#EEF0F4] rounded-[9px]">
      <header className="h-7 flex items-center justify-between px-[13px] border-b border-[#EEF0F4]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A94A6]">
          Deliverable emails
        </h2>
        {rows.length > 0 && (
          <span className="text-[10px] text-[#8A94A6] tabular-nums">
            {rows.length} of {MAX_DELIVERABLE_EMAILS}
          </span>
        )}
      </header>

      <div className="px-[13px] py-[9px]">
        {loading && rows.length === 0 ? (
          <p className="text-[11.5px] text-[#8A94A6]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[11.5px] text-[#8A94A6]">
            Nobody is copied on this order&apos;s confirmation yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-[6px]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 min-w-0">
                <span className="flex-1 min-w-0 text-[12px] text-[#1B2A4A] truncate" title={r.email}>
                  {r.email}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  disabled={busy}
                  className="text-[10.5px] font-semibold text-[#8E2A1E] hover:underline disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {!atLimit && (
          <div className="flex gap-2 mt-[9px]">
            <input
              type="email"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
              placeholder="email@example.com"
              className="flex-1 h-8 px-[9px] border border-[#EEF0F4] rounded-md text-[12px] text-[#1B2A4A] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || draft.trim() === ''}
              className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
        )}

        {error && <p className="mt-[6px] text-[11.5px] text-[#8E2A1E]">{error}</p>}

        <p className="mt-[8px] text-[10.5px] text-[#8A94A6] leading-snug">
          Copied on the order confirmation. Removing takes effect on the next send.
        </p>
      </div>
    </section>
  );
}
