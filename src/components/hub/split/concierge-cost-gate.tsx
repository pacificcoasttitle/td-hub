'use client';

import { useState } from 'react';

// ─── The confirmation gate ──────────────────────────────────────────────────
//
// Every generation is a billable SiteX lookup, and it cannot be undone: the
// wrong property costs the same as the right one. So this dialog exists to
// make the operator read the property back before the call is made.
//
// IT NO LONGER SAYS "CREDIT" (Gerard, 2026-09-23). The cost is real and still
// metered — sitex_credits_charged on every row, /api/concierge/spend for the
// admin usage view — but an operator holds no budget and cannot see a balance,
// so the wording asked them to weigh something that was never theirs to weigh.
// What made the spend deliberate was never the word: it is this dialog, and
// the duplicate check keyed on the normalised property over all time.
//
// Four properties, all of them enforced rather than described:
//
//   1. Confirm is NOT the default focus. Cancel is. A gate whose dangerous
//      button is pre-focused is a button that fires on a stray Return.
//   2. Enter does nothing. Explicitly swallowed on the whole dialog.
//   3. Disabled in flight, so a double-click cannot double-spend.
//   4. Escape cancels — the cheap way out is always available.

/**
 * MOUNTED ONLY WHILE OPEN. The parent renders `{open && <ConciergeCostGate …/>}`,
 * so every open starts from fresh state — the acknowledgement cannot survive a
 * cancel and pre-arm the next generation.
 */
export interface CostGateProps {
  address: string;
  preparedForName: string;
  preparedForCompany: string;
  presentingRepName: string;
  presentingRepProblem: string | null;
  criteriaSummary: string;
  spend: { thisMonth: number; allTime: number } | null;
  submitting: boolean;
  error: string | null;
  onPreparedForName: (v: string) => void;
  onPreparedForCompany: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConciergeCostGate(p: CostGateProps) {
  const [ack, setAck] = useState(false);

  const missingPreparedFor = p.preparedForName.trim() === '';
  const missingRep = p.presentingRepName.trim() === '';
  const blocked = missingPreparedFor || missingRep || !ack || p.submitting;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="concierge-gate-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !p.submitting) { e.stopPropagation(); p.onCancel(); }
        // Enter never confirms. The operator must click the button.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
      }}
    >
      <div className="bg-white rounded-[10px] w-full max-w-[520px] shadow-xl border border-[#E5E5E5]">
        <div className="px-5 py-4 border-b border-[#F0F1F3]">
          <h2 id="concierge-gate-title" className="text-[15px] font-semibold text-[#171717]">
            Generate a property profile
          </h2>
          {/* WHERE, not just "afterwards". The control is the Comparables
              button on this profile's row in Reports; saying so is the
              difference between a promise and an instruction. */}
          <p className="text-[11.5px] text-[#6B7280] mt-[3px]">
            One property lookup per profile. You can adjust the comparables afterwards from
            the report&rsquo;s row in Reports, as often as you like — re-rendering looks nothing up.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <GateRow label="Property" value={p.address} />

          <div>
            <label className="block text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA] mb-1">
              Prepared for
            </label>
            <input
              value={p.preparedForName}
              onChange={(e) => p.onPreparedForName(e.target.value)}
              placeholder="Client or agent name"
              className="w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange"
            />
            <input
              value={p.preparedForCompany}
              onChange={(e) => p.onPreparedForCompany(e.target.value)}
              placeholder="Brokerage (optional)"
              className="w-full h-8 px-[9px] mt-[6px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange"
            />
          </div>

          <GateRow
            label="Presenting representative"
            value={p.presentingRepName || p.presentingRepProblem
              || 'No presenting representative — the profile goes out under their name.'}
            warn={missingRep}
          />
          <GateRow label="Comparable criteria" value={p.criteriaSummary} />

          {/* ─── The spend panel is GONE from here (Gerard, 2026-09-23) ─────
              Operators do not hold a budget and cannot read a balance, so a
              running credit count asked them to weigh something they had no
              standing to weigh. The metering itself is untouched: every call
              still writes sitex_credits_charged, and /api/concierge/spend
              still serves the admin usage view for the people who do own the
              cost.

              WHAT CARRIES THE DELIBERATENESS NOW. The words were never the
              real guard. The guard is this dialog existing at all — Cancel
              focused, Enter swallowed, an explicit tick, disabled in flight —
              plus the duplicate check keyed on the normalised property over
              all time, which is the thing that actually stops a second
              lookup on a property we already hold. */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-[2px] w-[14px] h-[14px] rounded border-gray-300 text-brand-orange"
            />
            <span className="text-[11.5px] text-[#3C4557]">
              I have checked the property above and want to generate this profile.
            </span>
          </label>

          {p.error && (
            <p className="text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">
              {p.error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#F0F1F3] flex items-center justify-end gap-2">
          <button
            // Focus lands on CANCEL. Never on the button that spends money.
            autoFocus
            type="button"
            onClick={p.onCancel}
            disabled={p.submitting}
            className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB] disabled:opacity-50 outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={p.onConfirm}
            disabled={blocked}
            className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover disabled:opacity-40 outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
          >
            {p.submitting ? 'Generating…' : 'Generate profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GateRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA]">{label}</p>
      <p className={`text-[12px] ${warn ? 'text-[#B4620B]' : 'text-[#171717]'}`}>{value}</p>
    </div>
  );
}
