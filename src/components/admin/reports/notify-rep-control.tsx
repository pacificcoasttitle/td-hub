'use client';

import { useState } from 'react';
import type { ReportListRow } from '@/lib/domain/reports/list-types';

// ─── Notify rep ─────────────────────────────────────────────────────────────
//
// Emails the branded rep their report, PDF attached. NOT "Send": delivering to
// an outside agent is a different act and is not built.
//
// One confirmation, naming who and where, because this is an email leaving the
// building. The address shown is the one the send will use — the snapshot on
// the report row — so what the operator confirms is what happens.
//
// After the attempt the list reloads: the Delivery cell reads the log, so it
// shows Sent or Failed from the row the attempt wrote, not from anything
// this component believes.

/** The sentence the operator confirms. Says who, where, and what goes. */
export function notifyConfirmText(row: Pick<ReportListRow, 'brandedToName' | 'brandedToEmail' | 'typeLabel'>): string {
  return `Email this ${row.typeLabel} report to ${row.brandedToName ?? 'the rep'} at ${row.brandedToEmail}? The PDF is attached.`;
}

/** Why the button is off, when it is. Null means it can be used. */
export function notifyBlockedReason(row: Pick<ReportListRow, 'brandedToEmail' | 'brandedToName'>): string | null {
  return row.brandedToEmail?.trim() ? null : `${row.brandedToName ?? 'This rep'} has no email address on the report.`;
}

export function NotifyRepControl({ row, onChanged }: { row: ReportListRow; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = notifyBlockedReason(row);

  async function notify() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/reports/${row.type}/${row.id}/notify`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Not sent (${res.status}).`);
        // A failed attempt still wrote a row; the Delivery cell should show it.
        if (body?.deliveryId) onChanged?.();
        return;
      }
      setOpen(false);
      onChanged?.();
    } catch {
      setError('Network error — the email may or may not have gone. The Delivery column will say once the list reloads.');
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!!blocked}
        title={blocked ?? undefined}
        onClick={() => { setError(null); setOpen(true); }}
        className="text-xs font-medium text-[#1B2A4A] hover:underline disabled:text-[#9AA0AA] disabled:no-underline disabled:cursor-not-allowed"
      >
        Notify rep
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setOpen(false); }}
        >
          <div className="bg-white rounded-[10px] w-full max-w-[420px] shadow-xl border border-[#E5E5E5] text-left whitespace-normal">
            <div className="px-5 py-4 border-b border-[#F0F1F3]">
              <h2 className="text-[15px] font-semibold text-[#171717]">Notify rep</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-[12.5px] text-[#3C4557]">{notifyConfirmText(row)}</p>
              {error ? (
                <p className="text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">{error}</p>
              ) : null}
            </div>
            <div className="px-5 py-3 border-t border-[#F0F1F3] flex items-center justify-end gap-2">
              <button
                autoFocus
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={notify}
                className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-[#1B2A4A] text-white hover:bg-[#243658] disabled:opacity-40"
              >
                {busy ? 'Notifying…' : 'Notify rep'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
