'use client';

import { PreparedForField } from './prepared-for-field';

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
  /** Opt-in, and it is a second billable search. Default off. */
  taxDetail: boolean;
  onTaxDetail: (v: boolean) => void;
  onPreparedForName: (v: string) => void;
  onPreparedForCompany: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConciergeCostGate(p: CostGateProps) {


  const missingPreparedFor = p.preparedForName.trim() === '';
  const missingRep = p.presentingRepName.trim() === '';
  const blocked = missingPreparedFor || missingRep || p.submitting;

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

          {/* Suggestions, not a picker. A new client must stay typeable — see
              PreparedForField. Nothing about the gate's guards changes: the
              Generate button is still blocked while this is empty. */}
          <PreparedForField
            name={p.preparedForName}
            company={p.preparedForCompany}
            onName={p.onPreparedForName}
            onCompany={p.onPreparedForCompany}
          />

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
              focused, Enter swallowed, disabled in flight — plus the duplicate
              check keyed on the normalised property over all time, which is
              the thing that actually stops a second lookup on a property we
              already hold.

              ─── The acknowledgement tick is GONE (Gerard, 2026-09-30) ───────
              An extra step, and not the one doing the work. Five near-duplicate
              profiles exist on one parcel and every one of them was ticked:
              an operator who has decided to generate will tick anything in the
              way. What stopped those was never available to them — the
              "we already hold this" panel tells them the profile exists, and
              the free re-render gives them the reason most of those five were
              bought in the first place, which was wanting to see the document.

              So the tick goes and those two stay prominent. If duplicates rise
              after this, the answer is to make those two louder, not to put
              the checkbox back. */}

          {/* ─── The one opt-in on this dialog, and it costs ────────────────
              DEFAULT OFF (Gerard). The label names the charge — "one
              additional search" — rather than saying "include taxes", because
              "include" reads like a formatting choice and this is a second
              purchase from a second vendor.

              It is NOT the acknowledgement checkbox coming back. That one asked
              the operator to confirm something they had already decided, and
              every one of the five duplicate profiles was generated with it
              ticked. This one changes what happens.

              It also says what NOT ticking costs, which is nothing: page 4
              still renders from the assessment detail the SiteX call already
              paid for. An opt-in that reads as "or go without a tax page" gets
              ticked every time, and then it is not opt-in. */}
          <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-[#EDEFF3] bg-[#FAFAFB] px-3 py-2">
            <input
              type="checkbox"
              checked={p.taxDetail}
              disabled={p.submitting}
              onChange={(e) => p.onTaxDetail(e.target.checked)}
              className="mt-[2px] w-[14px] h-[14px] rounded border-gray-300 text-brand-orange"
            />
            <span className="text-[11.5px] text-[#3C4557]">
              <strong className="font-semibold">Add property tax detail</strong>
              {' — one additional search.'}
              <span className="block text-[10.5px] text-[#6B7280] mt-[2px]">
                Installments, due dates, the rate area and any direct assessments. It runs after
                the profile is delivered and adds a page for free when it lands. Without it the
                tax page still shows the assessment detail this lookup already includes.
              </span>
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
